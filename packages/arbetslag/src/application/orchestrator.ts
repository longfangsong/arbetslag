import { ok, err, Result } from "neverthrow";
import { nanoid } from "nanoid";
import z from "zod";
import { EventBus } from "./event/bus";
import { CompactRequest, Event, MessageEvent, ToolCallRequest } from "./event/event";
import { unwrap } from "../utils";
import { Agent } from "./agent/model";
import type { Context } from "./context";
import type { AIProvider } from "./aiProvider/model";
import type { OutputEvent, OutputRouter } from "./outputRouter/model";
import {
  DEFAULT_COMPACT_RETAIN_ROUNDS,
  DEFAULT_COMPACT_THRESHOLD,
  compactAgent,
  meteredTokens,
} from "./agent/compact";
import createDebug from "debug";

const orchLog = createDebug("arbetslag:orchestrator");
const toolLog = createDebug("arbetslag:tool");

export type OrchestratorDeps = Omit<Context, "eventBus">;

export class Orchestrator {
  private readonly bus = new EventBus();
  private readonly context: Context;

  constructor(deps: OrchestratorDeps) {
    this.context = { ...deps, eventBus: this.bus };
  }

  push(event: Event) {
    this.bus.push(event);
  }

  empty(): boolean {
    return this.bus.empty();
  }

  async step(): Promise<Result<void, string>> {
    const event = this.bus.pop();
    if (event) return this.dispatch(event);
    // Nothing on the bus: an agent may still hold pending events (e.g. its queue
    // was restored from a checkpoint), so drain whichever agent is not idle.
    for (const agent of await this.context.agentRepository.list()) {
      if (agent.hasEventToHandle()) return this.stepAgent(agent);
    }
    return ok(undefined);
  }

  /** Step until the bus is empty and every agent's own queue is empty. */
  async stepUntilIdle(maxIterations = 1024): Promise<Result<void, string>> {
    let iterations = 0;
    while (!(await this.idle()) && iterations < maxIterations) {
      const result = await this.step();
      if (result.isErr()) return err(result.error);
      iterations++;
    }
    if (!(await this.idle())) {
      const pendingAgents = (await this.context.agentRepository.list()).filter((a) => a.hasEventToHandle()).length;
      orchLog(`stopped at maxIterations=${maxIterations}, ${this.bus.queue.length} event(s) on the bus, ${pendingAgents} agent(s) with pending events`);
    }
    return ok(undefined);
  }

  private async idle(): Promise<boolean> {
    if (!this.bus.empty()) return false;
    for (const agent of await this.context.agentRepository.list()) {
      if (agent.hasEventToHandle()) return false;
    }
    return true;
  }

  /**
   * Deliver an event to the agent it belongs to. The agent handles only events
   * that change its own state (its history and counters); anything that needs
   * an external capability — AI provider, tool execution, output router — is
   * handled here.
   */
  private async dispatch(event: Event): Promise<Result<void, string>> {
    orchLog(`deliver ${event.event_type} id=${event.id}`);
    const agent = await this.resolveAgent(event);
    if (!agent) return err(`no agent for event ${event.event_type} id=${event.id}`);

    switch (event.event_type) {
      case "llm_completion_request":
        return this.complete(agent);
      case "tool_call_request":
        return this.executeTool(agent, event);
      case "compact_request":
        return this.compact(agent, await this.context.aiProviderRepository.getByName(agent.template.ai_provider));
      case "agent_output":
        return this.routeOutput(agent, event);
      default:
        // Agent-scoped event: queue it so the agent's own ordering rules hold.
        return this.stepAgent(agent, event);
    }
  }

  private async stepAgent(agent: Agent, event?: Event): Promise<Result<void, string>> {
    if (event) agent.pushEvent(event);
    const produced = agent.stepAgent();
    if (produced.isErr()) return err(produced.error);
    return this.deliver(agent, produced.value);
  }

  private async complete(agent: Agent): Promise<Result<void, string>> {
    const template = agent.template;
    const aiProvider = await this.context.aiProviderRepository.getByName(template.ai_provider);
    if (!aiProvider) {
      // Configuration error: the template names a provider we don't have.
      orchLog(`❌ AI provider not found: ${template.ai_provider}`);
      throw new Error(`AI provider not found: ${template.ai_provider}`);
    }
    if (meteredTokens(agent) >= (template.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD)) {
      const result = await this.compact(agent, aiProvider);
      if (result.isErr()) return err(result.error);
    }
    const outputSchema = template.outputSchema ? z.fromJSONSchema(template.outputSchema) : undefined;
    const completion = await aiProvider.complete(
      template.model,
      // agent.history, not the event's snapshot: compaction above may have rewritten it.
      agent.history,
      this.context.toolRepository.getByNames(template.allowedTools),
      outputSchema,
    );
    if (completion.isErr()) return err(completion.error);
    return this.deliver(agent, [
      {
        id: nanoid(10),
        event_type: "llm_completion_response",
        to_agent_id: agent.id,
        content: completion.value.content,
        tool_calls: completion.value.tool_calls,
        usage: completion.value.usage,
      },
    ]);
  }

  private async executeTool(
    agent: Agent,
    event: ToolCallRequest,
  ): Promise<Result<void, string>> {
    const tool = await this.context.toolRepository.getByName(event.tool_call.tool_name);
    if (!tool) {
      toolLog(`❌ tool not found: ${event.tool_call.tool_name}`);
    }
    const result = await tool?.call(this.context, agent, event.tool_call.arguments);
    const content =
      result === undefined
        ? "Tool not found"
        : result.isOk()
          ? JSON.stringify(result.value)
          : JSON.stringify(result.error);
    return this.deliver(agent, [
      {
        id: nanoid(10),
        event_type: "tool_call_response",
        to_agent_id: agent.id,
        tool_call_id: event.tool_call.id,
        name: tool?.name ?? event.tool_call.tool_name,
        content,
      },
    ]);
  }

  private async compact(
    agent: Agent,
    provider: AIProvider | null,
  ): Promise<Result<void, string>> {
    const template = agent.template;
    const result = await compactAgent({
      agent,
      provider,
      threshold: template.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD,
      retainRounds: template.compactRetainRounds ?? DEFAULT_COMPACT_RETAIN_ROUNDS,
      summaryPrompt: template.compactSummaryPrompt,
    });
    if (result.isErr()) return err(result.error);
    if (result.value.compacted) {
      const notice = await this.routeOutput(agent, {
        kind: "history_compacted",
        beforeTokens: result.value.beforeTokens,
        afterTokens: result.value.afterTokens,
      });
      if (notice.isErr()) return err(notice.error);
    }
    return ok(undefined);
  }

  /** An agent's output goes to the router that belongs to that agent. */
  private async routeOutput(agent: Agent, event: OutputEvent): Promise<Result<void, string>> {
    return await agent.outputRouter.route(event);
  }

  /** Checkpoint the agent, then hand the events it produced to the bus. */
  private async deliver(agent: Agent, produced: Array<Event>): Promise<Result<void, string>> {
    await this.context.agentRepository.save(agent);
    for (const event of produced) this.bus.push(event);
    return ok(undefined);
  }

  private async resolveAgent(event: Event): Promise<Agent | null> {
    const { agentRepository, templateRepository } = this.context;

    if (event.event_type === "message" || event.event_type === "compact_request") {
      const agent = await agentRepository.getByChatId(event.chat_id);
      if (agent) return agent;
      // a missing default template is a configuration error —
      // the one place we still throw (crash, don't silently misroute).
      const template = unwrap(await templateRepository.default());
      const entryAgent = Agent.create(template, this.newEntryAgentRouter(event));
      entryAgent.chatId = event.chat_id;
      await agentRepository.setEntryAgent(event.chat_id, entryAgent);
      return entryAgent;
    }

    let agentId: string | undefined;
    if ("to_agent_id" in event) {
      agentId = event.to_agent_id;
    } else if ("from_agent_id" in event) {
      agentId = event.from_agent_id;
    }
    if (!agentId) return null;
    return agentRepository.getById(agentId);
  }

  /** A brand-new agent has no persisted router: take it from the event's adapter. */
  private newEntryAgentRouter(event: MessageEvent | CompactRequest): OutputRouter {
    if (!("adapter" in event)) {
      throw "panic";
    }
    return this.context.outputRouterRegistry.resolve({
      kind: event.adapter,
      config: { chatId: event.chat_id },
    });
  }
}
