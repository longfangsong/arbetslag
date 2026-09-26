import { nanoid } from "nanoid";
import { z } from "zod";
import { ok, err, Result } from "neverthrow";
import createDebug from "debug";
import { Template } from "./template/model";
import { HistoryEntry, text, contentText } from "./history";
import {
  AgentMessageEvent,
  ApiCallbackEvent,
  Event,
  LLMCompletionRequest,
  LLMCompletionResponse,
  MessageEvent,
  ToolCallRequest,
  ToolResponseEvent,
} from "@/application/event/event";
import { Context } from "../context";
import {
  type CompactResult,
  compactAgent,
  estimateHistoryTokens,
  DEFAULT_COMPACT_THRESHOLD,
  DEFAULT_COMPACT_RETAIN_ROUNDS,
} from "./compact";
import type { AIProvider } from "../aiProvider/model";

const agentLog = createDebug("arbetslag:agent");
const toolLog = createDebug("arbetslag:tool");

export interface SerializedAgent {
  id: string;
  template: Template;
  eventQueue: Array<Event>;
  history: Array<HistoryEntry>;
  chatId?: string;
  waitingForToolCallCount?: number;
  lastPromptTokens?: number;
}

/**
 * Framework meta prompt appended to every agent's system entry: tells the
 * LLM what the framework's built-in input wrappers (<agent_message>,
 * <api_callback>) mean, so behavior doesn't drift with the model's guess at
 * the tag names. English, like the built-in compact summary prompt; the
 * leading newline separates it from the app's system prompt.
 */
const META_SYSTEM_PROMPT = `# Agent 框架元消息

有时你会收到一些包裹在 xml 标签中的消息，这些消息是由框架包装的，不是由人类用户输入的：
- <agent_message>：由另一个 Agent 发送的消息；其中 <from_agent_id> 字段标识发送者的 Agent ID。
- <api_callback>：外部异步 API 调用的结果，通常来自工具调用的 callback；其中 <api_name> 为 API 名称。
`;

/**
 * The system entry (history[0]) content: the app's template system prompt
 * plus the framework meta prompt. Single composition point shared by
 * Agent.create, the deserialize backfill and LLM-level compaction, so the
 * meta prompt survives compaction and every loaded agent has it.
 * template.systemPrompt stays purely app-controlled.
 */
export function composeSystemPrompt(template: Template): string {
  if (template.systemPrompt.indexOf("{{META_SYSTEM_PROMPT}}") === -1) {
    return template.systemPrompt + META_SYSTEM_PROMPT;
  }
  return template.systemPrompt.replace("{{META_SYSTEM_PROMPT}}", META_SYSTEM_PROMPT);
}

export class Agent {
  public readonly id: string;
  public readonly template: Template;
  public eventQueue: Array<Event> = [];
  public history: Array<HistoryEntry> = [];
  public chatId?: string;
  /**
   * Real prompt_tokens of the last LLM response (see
   * docs/adr/0001-compact-token-metering.md): the agent meters its next
   * request as this value plus an estimate of the history added since.
   */
  public lastPromptTokens?: number;
  private waitingForToolCallCount = 0;

  private constructor(
    id: string,
    template: Template,
    history: Array<HistoryEntry>,
  ) {
    this.id = id;
    this.template = template;
    this.history = history;
  }

  static create(template: Template): Agent {
    return new Agent(nanoid(10), template, [
      { role: "system", content: text(composeSystemPrompt(template)) },
    ]);
  }

  static deserialize(data: SerializedAgent): Agent {
    const agent = new Agent(data.id, data.template, data.history);
    if (data.chatId) agent.chatId = data.chatId;
    if (data.waitingForToolCallCount != null) agent.waitingForToolCallCount = data.waitingForToolCallCount;
    if (data.lastPromptTokens != null) agent.lastPromptTokens = data.lastPromptTokens;
    if (data.eventQueue) agent.eventQueue = data.eventQueue;
    return agent;
  }

  serialize(): SerializedAgent {
    return {
      id: this.id,
      template: this.template,
      history: this.history,
      chatId: this.chatId,
      waitingForToolCallCount: this.waitingForToolCallCount,
      lastPromptTokens: this.lastPromptTokens,
      eventQueue: this.eventQueue
    };
  }

  // Invalidate the lastPromptTokens so that the next request will be metered with a new estimate.
  // Use when the history has been changed, e.g. after compaction.
  clearLastPromptTokens(): void {
    this.lastPromptTokens = undefined;
  }

  push(event: Event): void {
    this.eventQueue.push(event);
  }

  idle(): boolean {
    return this.eventQueue.length === 0;
  }

  /**
   * Drain this agent's own queue one event at a time and return the events it
   * produced — the orchestrator is the one that puts them on the bus.
   */
  async dispatch(context: Context): Promise<Result<Array<Event>, string>> {
    const produced: Array<Event> = [];
    while (!this.idle()) {
      const event = this.eventQueue.shift()!;
      agentLog(`dispatch ${event.event_type} id=${event.id} agent=${this.id}`);
      const result = await this.handle(event, context);
      if (result.isErr()) return err(result.error);
      produced.push(...result.value);
    }
    return ok(produced);
  }

  private async handle(
    event: Event,
    context: Context,
  ): Promise<Result<Array<Event>, string>> {
    switch (event.event_type) {
      case "message":
        return ok(this.handleMessage(event));
      case "agent_message":
        return ok(this.handleAgentMessage(event));
      case "api_callback":
        return ok(this.handleApiCallback(event));
      case "tool_call_response":
        return ok(this.handleToolResponse(event));
      case "llm_completion_response":
        return ok(this.handleLLMCompletionResponse(event));
      case "llm_completion_request":
        return this.handleLLMCompletionRequest(event, context);
      case "tool_call_request":
        return this.handleToolCallRequest(event, context);
      case "compact_request":
        return this.handleCompactRequest(context);
      case "agent_output":
        if (!context.outputRouter) return ok([]);
        const routed = await context.outputRouter.route(event);
        if (routed.isErr()) return err(routed.error);
        return ok([]);
    }
  }

  private async handleLLMCompletionRequest(
    event: LLMCompletionRequest,
    context: Context,
  ): Promise<Result<Array<Event>, string>> {
    const template = this.template;
    const aiProvider = await context.aiProviderRepository.getByName(
      template.ai_provider,
    );
    if (!aiProvider) {
      // Configuration error: the template names a provider we don't have.
      agentLog(`❌ AI provider not found: ${template.ai_provider}`);
      throw new Error(`AI provider not found: ${template.ai_provider}`);
    }
    const compactResult = await this.compactIfNeeded(aiProvider, context);
    if (compactResult.isErr()) return err(compactResult.error);
    const outputSchema = template.outputSchema
      ? z.fromJSONSchema(template.outputSchema)
      : undefined;
    const completion = await aiProvider.complete(
      template.model,
      this.history,
      context.toolRepository.getByNames(template.allowedTools),
      outputSchema,
    );
    if (completion.isErr()) return err(completion.error);
    return ok([
      {
        id: nanoid(10),
        event_type: "llm_completion_response",
        to_agent_id: this.id,
        content: completion.value.content,
        tool_calls: completion.value.tool_calls,
        usage: completion.value.usage,
      },
    ]);
  }

  private async handleToolCallRequest(
    event: ToolCallRequest,
    context: Context,
  ): Promise<Result<Array<Event>, string>> {
    const tool = await context.toolRepository.getByName(
      event.tool_call.tool_name,
    );
    const result = await tool?.call(context, this, event.tool_call.arguments);
    if (result === undefined) {
      toolLog(`❌ tool not found: ${event.tool_call.tool_name}`);
    }
    const content =
      result === undefined
        ? "Tool not found"
        : result.isOk()
          ? JSON.stringify(result.value)
          : JSON.stringify(result.error);
    return ok([
      {
        id: nanoid(10),
        event_type: "tool_call_response",
        to_agent_id: this.id,
        tool_call_id: event.tool_call.id,
        name: tool!.name,
        content,
      },
    ]);
  }

  private async handleCompactRequest(
    context: Context,
  ): Promise<Result<Array<Event>, string>> {
    const provider = await context.aiProviderRepository.getByName(
      this.template.ai_provider,
    );
    const result = await compactAgent({
      agent: this,
      provider,
      threshold: this.template.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD,
      retainRounds:
        this.template.compactRetainRounds ?? DEFAULT_COMPACT_RETAIN_ROUNDS,
      summaryPrompt: this.template.compactSummaryPrompt,
    });
    if (result.isErr()) return err(result.error);
    const notice = await this.notifyCompact(result.value, context);
    if (notice.isErr()) return err(notice.error);
    return ok([]);
  }

  /**
   * Compact the agent's history before an LLM request if the metered size
   * crosses the template threshold (ADR-0001 metering). The outcome is always
   * routed as a Compacted notice; the output router decides whether and how
   * to tell the user.
   */
  private async compactIfNeeded(
    provider: AIProvider | null,
    context: Context,
  ): Promise<Result<void, string>> {
    const template = this.template;
    const threshold = template.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD;
    const retainRounds =
      template.compactRetainRounds ?? DEFAULT_COMPACT_RETAIN_ROUNDS;
    // lastPromptTokens branch: that request already covered history up to
    // (but not including) the last assistant entry, so meter that entry plus
    // all newer ones. Derived rather than stored: every LLM call appends
    // exactly one assistant entry (agent messages are stored as user-role
    // entries).
    let lastAssistantIndex = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].role === "assistant") {
        lastAssistantIndex = i;
        break;
      }
    }
    const meteredTokens =
      this.lastPromptTokens != null
        ? this.lastPromptTokens + estimateHistoryTokens(this.history.slice(lastAssistantIndex))
        : estimateHistoryTokens(this.history); // history[0] is the system entry
    if (meteredTokens < threshold) return ok(undefined);
    const result = await compactAgent({
      agent: this,
      provider,
      threshold,
      retainRounds,
      summaryPrompt: template.compactSummaryPrompt,
    });
    if (result.isErr()) return err(result.error);
    if (result.value.compacted) {
      const notice = await this.notifyCompact(result.value, context);
      if (notice.isErr()) return err(notice.error);
    }
    return ok(undefined);
  }

  private async notifyCompact(
    result: CompactResult,
    context: Context,
  ): Promise<Result<void, string>> {
    if (!context.outputRouter) return Promise.resolve(ok(undefined));
    // Tokens set ⇔ something was compacted; the host renders the wording.
    return context.outputRouter.route({
      kind: "history_compacted",
      beforeTokens: result.compacted ? result.beforeTokens : undefined,
      afterTokens: result.compacted ? result.afterTokens : undefined,
    });
  }

  handleMessage(event: MessageEvent): Array<Event> {
    this.history.push({
      role: "user",
      content: event.content,
    });
    return [
      {
        id: nanoid(10),
        event_type: "llm_completion_request",
        from_agent_id: this.id,
        history: this.history,
      },
    ];
  }

  handleAgentMessage(event: AgentMessageEvent): Array<Event> {
    this.history.push({
      role: "user",
      content: text(`<agent_message>
					<from_agent_id>${event.from_agent_id}</from_agent_id>
					<content>${event.content}</content>
				</agent_message>`),
    });
    return [
      {
        id: nanoid(10),
        event_type: "llm_completion_request",
        from_agent_id: this.id,
        history: this.history,
      },
    ];
  }

  handleApiCallback(event: ApiCallbackEvent): Array<Event> {
    this.history.push({
      role: "user",
      content: text(`<api_callback>
					<id>${event.id}</id>
					<api_name>${event.api_name}</api_name>
					<payload>
						${event.content}
					</payload>
				</api_callback>`),
    });
    return [
      {
        id: nanoid(10),
        event_type: "llm_completion_request",
        from_agent_id: this.id,
        history: this.history,
      },
    ];
  }

  handleToolResponse(event: ToolResponseEvent): Array<Event> {
    this.history.push({
      role: "tool",
      tool_call_id: event.tool_call_id,
      name: event.name,
      content: event.content,
    });
    --this.waitingForToolCallCount;
    if (this.waitingForToolCallCount === 0) {
      return [
        {
          id: nanoid(10),
          event_type: "llm_completion_request",
          from_agent_id: this.id,
          history: this.history,
        },
      ];
    }
    return [];
  }

  handleLLMCompletionResponse(event: LLMCompletionResponse): Array<Event> {
    this.history.push({
      role: "assistant",
      content: event.content,
      tool_calls: event.tool_calls,
    });
    if (event.usage?.prompt_tokens != null) {
      this.lastPromptTokens = event.usage.prompt_tokens;
    }
    this.waitingForToolCallCount = event.tool_calls ? event.tool_calls.length : 0;
    const events: Array<Event> = [];
    for (const toolCall of event.tool_calls || []) {
      events.push({
        id: nanoid(10),
        event_type: "tool_call_request",
        from_agent_id: this.id,
        tool_call: toolCall,
      });
    }
    if (event.content) {
      events.push({
        id: nanoid(10),
        event_type: "agent_output",
        from_agent_id: this.id,
        content: event.content,
      });
    }
    return events;
  }
}
