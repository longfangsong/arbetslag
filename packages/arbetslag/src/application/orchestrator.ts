import { z } from "zod";
import { nanoid } from "nanoid";
import { Result, ok, err } from "neverthrow";
import { EventBus } from "./event/bus";
import { unwrap } from "../utils";
import {
  Event,
  ToolCallRequest,
  MessageEvent,
  ToolResponseEvent,
  AgentMessageEvent,
  ApiCallbackEvent,
  LLMCompletionRequest,
  LLMCompletionResponse,
  AgentOutput,
  CompactRequest,
} from "./event/event";
import { Agent, MAX_AGENT_DEPTH } from "./agent/model";
import { reportOf, openWaits, WAIT_TOOL_NAME } from "./agent/report";
import {
  type CompactResult,
  compactAgent,
  estimateHistoryTokens,
  DEFAULT_COMPACT_THRESHOLD,
  DEFAULT_COMPACT_RETAIN_ROUNDS,
} from "./agent/compact";
import { FileSystem } from "./file/model";
import type { Repository as AgentRepository } from "./agent/repository";
import type { Repository as TemplateRepository } from "./agent/template/repository";
import type { Repository as ToolRepository } from "./tool/repository";
import type { ToolExecutingContext } from "./tool/model";
import type { Repository as AIProviderRepository } from "./aiProvider/repository";
import type { AIProvider } from "./aiProvider/model";
import type { OutputRouter } from "./outputRouter/model";
import { ReportRouter } from "./outputRouter/reportRouter";
import createDebug from "debug";

const orchLog = createDebug("arbetslag:orchestrator");
const toolLog = createDebug("arbetslag:tool");

export interface OrchestratorDeps {
  fileSystem: FileSystem;
  agentRepository: AgentRepository;
  templateRepository: TemplateRepository;
  toolRepository: ToolRepository;
  aiProviderRepository: AIProviderRepository;
  outputRouter: OutputRouter | null;
}

export class Orchestrator {
  private readonly bus = new EventBus();

  constructor(private readonly deps: OrchestratorDeps) {}

  push(event: Event) {
    this.bus.push(event);
  }

  empty(): boolean {
    return this.bus.empty();
  }

  /**
   * On restore, before any other processing: a pending Wait is an unanswered
   * tool call in the persisted history, so it needs no extra state — but the
   * queue is not persisted, so a Report that arrived while the program was down
   * must be written as the response of the Wait that is still open for it.
   */
  async resolveOpenWaits(): Promise<void> {
    for (const agent of await this.deps.agentRepository.list()) {
      for (const wait of openWaits(agent.history)) {
        const target = await this.deps.agentRepository.getById(wait.arguments.agent_id);
        const report = target ? reportOf(target) : undefined;
        if (report === undefined) continue;
        orchLog(`restore: resolves open wait ${wait.id} for agent ${agent.id}`);
        this.push({
          id: wait.id,
          event_type: "tool_call_response",
          to_agent_id: agent.id,
          name: WAIT_TOOL_NAME,
          content: JSON.stringify(report),
        });
      }
    }
  }

  async step(): Promise<Result<Array<Event>, string>> {
    const event = this.bus.pop();
    if (!event) return ok([]);
    const result = await this.dispatch(event);
    if (result.isErr()) return result;
    for (const e of result.value) {
      this.bus.push(e);
    }
    return ok([]);
  }

  async stepUntilIdle(maxIterations = 1024): Promise<Result<void, string>> {
    let iterations = 0;
    while (!this.bus.empty() && iterations < maxIterations) {
      const result = await this.step();
      if (result.isErr()) return err(result.error);
      iterations++;
    }
    if (!this.bus.empty()) {
      orchLog(`stopped at maxIterations=${maxIterations}, ${this.bus.queue.length} event(s) left unprocessed`);
    }
    return ok(undefined);
  }

  /**
   * Every agent has an output router: the app's router for an agent that speaks
   * to a user, the Report router for one that has a Creator. Routers stay
   * stateless (the Report lives in history), so nothing is cached here.
   */
  private routerFor(agent: Agent): OutputRouter | null {
    return agent.createdByAgentId
      ? new ReportRouter(agent.id, this.deps.agentRepository, this.bus)
      : this.deps.outputRouter;
  }

  private async notifyCompact(
    agent: Agent,
    result: CompactResult,
  ): Promise<Result<void, string>> {
    const router = this.routerFor(agent);
    if (!router) return ok(undefined);
    // Tokens set ⇔ something was compacted; the router decides what to do with
    // the notice (send it, or nothing for an agent with no user).
    const routed = await router.route({
      kind: "history_compacted",
      beforeTokens: result.compacted ? result.beforeTokens : undefined,
      afterTokens: result.compacted ? result.afterTokens : undefined,
    });
    return routed.isErr() ? err(routed.error) : ok(undefined);
  }

  /**
   * Compact the agent's history before an LLM request if the metered size
   * crosses the template threshold. Metering: lastPromptTokens (last real
   * prompt_tokens) plus an estimate of the history added since, when
   * available; full estimation otherwise (ADR-0001). The outcome is always
   * routed as a Compacted notice; the output router decides whether and how
   * to tell the user.
   */
  private async compactIfNeeded(
    agent: Agent,
    provider: AIProvider | null,
  ): Promise<Result<void, string>> {
    const { agentRepository } = this.deps;
    const template = agent.template;
    const threshold =
      template.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD;
    const retainRounds =
      template.compactRetainRounds ?? DEFAULT_COMPACT_RETAIN_ROUNDS;
    // lastPromptTokens branch: that request already covered history up to
    // (but not including) the last assistant entry, so meter that entry plus
    // all newer ones. Derived rather than stored: every LLM call appends
    // exactly one assistant entry (agent messages are stored as user-role
    // entries).
    let lastAssistantIndex = 0;
    for (let i = agent.history.length - 1; i >= 0; i--) {
      if (agent.history[i].role === "assistant") {
        lastAssistantIndex = i;
        break;
      }
    }
    const meteredTokens =
      agent.lastPromptTokens != null
        ? agent.lastPromptTokens + estimateHistoryTokens(agent.history.slice(lastAssistantIndex))
        : estimateHistoryTokens(agent.history); // history[0] is the system entry
    if (meteredTokens < threshold) return ok(undefined);
    const result = await compactAgent({
      agent,
      provider,
      threshold,
      retainRounds,
      summaryPrompt: template.compactSummaryPrompt,
    });
    if (result.isErr()) return err(result.error);
    await agentRepository.save(agent);
    if (result.value.compacted) {
      const notice = await this.notifyCompact(agent, result.value);
      if (notice.isErr()) return err(notice.error);
    }
    return ok(undefined);
  }

  /**
   * Create a Sub-agent from a pre-declared Template and queue its task as the
   * first message (a Round boundary). Creation is immediate — nothing here
   * waits for the Sub-agent's work. Depth is computed by walking the Creator
   * chain, never stored; the Sub-agent's Chat stays the Creator's through the
   * Creator link, so no second chat reference is written.
   */
  private async createSubAgent(
    templateName: string,
    task: string,
    creator: Agent,
    pushEvent: (event: Event) => void,
  ): Promise<Result<string, string>> {
    const { agentRepository, templateRepository } = this.deps;
    const template = await templateRepository.getByName(templateName);
    if (!template) return err(`Template not found: ${templateName}`);

    let depth = 1; // the Creator itself
    let current: Agent | null = creator;
    while (current?.createdByAgentId) {
      current = await agentRepository.getById(current.createdByAgentId);
      depth++;
    }
    if (depth >= MAX_AGENT_DEPTH) {
      toolLog(`❌ depth limit: creator at depth ${depth} cannot create`);
      return err(
        `Maximum Sub-agent depth of ${MAX_AGENT_DEPTH} exceeded: the Creator is already at depth ${depth}.`,
      );
    }

    const sub = Agent.create(template, creator);
    await agentRepository.add(sub);
    pushEvent({
      id: nanoid(10),
      event_type: "agent_message",
      from_agent_id: creator.id,
      to_agent_id: sub.id,
      content: task,
    });
    orchLog(`sub-agent created id=${sub.id} creator=${creator.id} depth=${depth + 1}`);
    return ok(sub.id);
  }

  private async dispatch(event: Event): Promise<Result<Array<Event>, string>> {
    orchLog(`dispatch ${event.event_type} id=${event.id}`);
    const {
      agentRepository,
      templateRepository,
      toolRepository,
      aiProviderRepository,
      fileSystem,
    } = this.deps;

    switch (event.event_type) {
      case "message": {
        const e = event as MessageEvent;
        let agent = await agentRepository.getByChatId(e.chat_id);
        if (!agent) {
          // a missing default template is a configuration error —
          // the one place we still throw (crash, don't silently misroute).
          const template = unwrap(await templateRepository.default());
          agent = Agent.create(template);
          await agentRepository.setEntryAgent(e.chat_id, agent);
        }
        const events = agent.handleMessage(e);
        await agentRepository.save(agent);
        return ok(events);
      }

      case "api_callback": {
        const e = event as ApiCallbackEvent;
        const agent = await agentRepository.getById(e.to_agent_id!);
        const events = agent?.handleApiCallback(e);
        if (agent) await agentRepository.save(agent);
        return ok(events ?? []);
      }

      case "tool_call_request": {
        const e = event as ToolCallRequest;
        const tool = await toolRepository.getByName(e.tool_call.tool_name);
        const agent = await agentRepository.getById(e.from_agent_id);
        const pushed: Array<Event> = [];
        const context: ToolExecutingContext = {
          fileSystem,
          pushEvent: (event) => pushed.push(event),
          createAgent: (templateName, task) =>
            this.createSubAgent(templateName, task, agent!, (event) => pushed.push(event)),
          getReport: async (agentId) => {
            const target = await agentRepository.getById(agentId);
            return target ? reportOf(target) : undefined;
          },
        };
        const result = await tool?.call(
          context,
          agent!,
          e.tool_call.arguments,
        );
        if (result === undefined) {
          toolLog(`❌ tool not found: ${e.tool_call.tool_name}`);
        }
        // A handler cannot block: an ok(undefined) result means the tool yields
        // and stays open (a Wait) — its response is written when the Report arrives.
        if (result?.isOk() && result.value === undefined) return ok(pushed);
        const content =
          result === undefined
            ? "Tool not found"
            : result.isOk()
              ? JSON.stringify(result.value)
              : JSON.stringify(result.error);
        return ok([
          {
            id: e.tool_call.id,
            event_type: "tool_call_response" as const,
            to_agent_id: agent!.id,
            name: tool!.name,
            content,
          },
          ...pushed,
        ]);
      }

      case "tool_call_response": {
        const e = event as ToolResponseEvent;
        const agent = await agentRepository.getById(e.to_agent_id);
        const events = agent?.handleToolResponse(e);
        if (agent) await agentRepository.save(agent);
        return ok(events ?? []);
      }

      case "agent_message": {
        const e = event as AgentMessageEvent;
        const agent = await agentRepository.getById(e.to_agent_id);
        const events = agent?.handleAgentMessage(e);
        if (agent) await agentRepository.save(agent);
        return ok(events ?? []);
      }

      case "llm_completion_request": {
        const e = event as LLMCompletionRequest;
        const agent = await agentRepository.getById(e.from_agent_id);
        const template = agent!.template;
        const aiProvider = await aiProviderRepository.getByName(
          template.ai_provider,
        );
        if (!aiProvider) {
          // Configuration error: the template names a provider we don't have.
          orchLog(`❌ AI provider not found: ${template.ai_provider}`);
          throw new Error(
            `AI provider not found: ${template.ai_provider}`,
          );
        }
        const compactResult = await this.compactIfNeeded(agent!, aiProvider);
        if (compactResult.isErr()) return err(compactResult.error);
        const outputSchema = template.outputSchema
          ? z.fromJSONSchema(template.outputSchema)
          : undefined;
        const completion = await aiProvider.complete(
          template.model,
          agent!.history,
          toolRepository.getByNames(template.allowedTools),
          outputSchema,
        );
        if (completion.isErr()) return err(completion.error);
        return ok([
          {
            id: nanoid(10),
            event_type: "llm_completion_response" as const,
            to_agent_id: agent!.id,
            content: completion.value.content,
            tool_calls: completion.value.tool_calls,
            usage: completion.value.usage,
          },
        ]);
      }

      case "compact_request": {
        const e = event as CompactRequest;
        let agent = await agentRepository.getByChatId(e.chat_id);
        if (!agent) {
          // First message in the chat is /compact: create the agent the same
          // way the "message" flow does, then compact (empty history ->
          // nothing to compact, but the agent now exists for the user).
          const template = unwrap(await templateRepository.default());
          agent = Agent.create(template);
          await agentRepository.setEntryAgent(e.chat_id, agent);
        }
        const result = await compactAgent({
          agent,
          provider: await aiProviderRepository.getByName(
            agent.template.ai_provider,
          ),
          threshold:
            agent.template.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD,
          retainRounds:
            agent.template.compactRetainRounds ??
            DEFAULT_COMPACT_RETAIN_ROUNDS,
          summaryPrompt: agent.template.compactSummaryPrompt,
        });
        if (result.isErr()) return err(result.error);
        await agentRepository.save(agent);
        const notice = await this.notifyCompact(agent, result.value);
        if (notice.isErr()) return err(notice.error);
        return ok([]);
      }

      case "llm_completion_response": {
        const e = event as LLMCompletionResponse;
        const agent = await agentRepository.getById(e.to_agent_id);
        if (!agent) return ok([]);
        const events = agent.handleLLMCompletionResponse(e);
        await agentRepository.save(agent);
        return ok(events);
      }

      case "agent_output": {
        const e = event as AgentOutput;
        const agent = await agentRepository.getById(e.from_agent_id);
        const router = agent ? this.routerFor(agent) : null;
        if (!router) return ok([]);
        // The router decides what an agent's output becomes: a message to the
        // user, or (for a router that answers on the agent's behalf) an event.
        const routed = await router.route(e);
        if (routed.isErr()) return err(routed.error);
        return ok([]);
      }
    }
  }
}
