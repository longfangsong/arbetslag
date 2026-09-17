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
import { Agent } from "./agent/model";
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
import type { Repository as AIProviderRepository } from "./aiProvider/repository";
import type { AIProvider } from "./aiProvider/model";
import type { OutputRouter } from "./outputRouter/model";

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
    return ok(undefined);
  }

  private notifyCompact(result: CompactResult): Promise<Result<void, string>> {
    if (!this.deps.outputRouter) return Promise.resolve(ok(undefined));
    return this.deps.outputRouter.route({
      kind: "history_compacted",
      // Tokens set ⇔ something was compacted; the host renders the wording.
      beforeTokens: result.compacted ? result.beforeTokens : undefined,
      afterTokens: result.compacted ? result.afterTokens : undefined,
    });
  }

  /**
   * Compact the agent's history before an LLM request if the metered size
   * crosses the template threshold. Metering: lastPromptTokens (last real
   * prompt_tokens) plus an estimate of the history added since, when
   * available; full estimation otherwise (ADR-0001). The outcome is always
   * routed as a SystemNotice; the output router decides whether and how to
   * tell the user.
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
      const notice = await this.notifyCompact(result.value);
      if (notice.isErr()) return err(notice.error);
    }
    return ok(undefined);
  }

  private async dispatch(event: Event): Promise<Result<Array<Event>, string>> {
    const {
      agentRepository,
      templateRepository,
      toolRepository,
      aiProviderRepository,
      fileSystem,
      outputRouter,
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
          agent.chatId = e.chat_id;
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
        const result = await tool?.call(
          { fileSystem },
          agent!,
          e.tool_call.arguments,
        );
        const content =
          result === undefined
            ? "Tool not found"
            : result.isOk()
              ? JSON.stringify(result.value)
              : JSON.stringify(result.error);
        return ok([
          {
            id: nanoid(10),
            event_type: "tool_call_response" as const,
            to_agent_id: agent!.id,
            tool_call_id: e.tool_call.id,
            name: tool!.name,
            content,
          },
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
          agent.chatId = e.chat_id;
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
        const notice = await this.notifyCompact(result.value);
        if (notice.isErr()) return err(notice.error);
        return ok([]);
      }

      case "llm_completion_response": {
        const e = event as LLMCompletionResponse;
        const agent = await agentRepository.getById(e.to_agent_id);
        const events = agent?.handleLLMCompletionResponse(e);
        if (agent) await agentRepository.save(agent);
        return ok(events ?? []);
      }

      case "agent_output": {
        const e = event as AgentOutput;
        if (outputRouter) {
          const routed = await outputRouter.route(e);
          if (routed.isErr()) return err(routed.error);
        }
        return ok([]);
      }
    }
  }
}
