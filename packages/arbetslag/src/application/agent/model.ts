import { nanoid } from "nanoid";
import { ok, err, Result } from "neverthrow";
import createDebug from "debug";
import { Template } from "./template/model";
import { HistoryEntry, text } from "./history";
import {
  AgentMessageEvent,
  ApiCallbackEvent,
  Event,
  LLMCompletionResponse,
  MessageEvent,
  ToolResponseEvent,
} from "@/application/event/event";

const agentLog = createDebug("arbetslag:agent");

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

/**
 * An Agent is a state machine over its own history: it handles only events
 * that change its own state. Anything needing an external capability (AI
 * provider, tool execution, output router) is handled by the Orchestrator,
 * which asks the agent for the completion/tool/output events it produces.
 */
export class Agent {
  public readonly id: string;
  public readonly template: Template;
  public eventQueue: Array<Event> = [];
  public history: Array<HistoryEntry> = [];
  public chatId?: string;
  /**
   * Real prompt_tokens of the last LLM response (see
   * docs/adr/0001-compact-token-metering.md): the metering point uses this
   * value plus an estimate of the history added since.
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

  pushEvent(event: Event): void {
    this.eventQueue.push(event);
  }

  private blocked_on_tool(): boolean {
    return this.waitingForToolCallCount > 0;
  }

  hasEventToHandle(): boolean {
    return this.eventQueue.length !== 0 &&
      (!this.blocked_on_tool() ||
        this.eventQueue.find(it => it.event_type === "tool_call_response") !== undefined);
  }

  /** Handle the next event of the agent's own queue. */
  stepAgent(): Result<Array<Event>, string> {
    if (this.blocked_on_tool()) {
      // blocked on tool calling, can only handle tool call result at this state
      const index = this.eventQueue.findIndex(it => it.event_type === "tool_call_response");
      if (index > 0) {
        // move it to first position
        const [response] = this.eventQueue.splice(index, 1);
        this.eventQueue.unshift(response);
      } else if (index === -1) {
        return ok([]);
      }
    }
    const event = this.eventQueue.shift()!;
    agentLog(`dispatch ${event.event_type} id=${event.id} agent=${this.id}`);
    return this.handle(event);
  }

  /** The events an agent can handle: those that only change its own state. */
  private handle(event: Event): Result<Array<Event>, string> {
    switch (event.event_type) {
      case "message":
        return this.handleMessage(event);
      case "agent_message":
        return this.handleAgentMessage(event);
      case "api_callback":
        return this.handleApiCallback(event);
      case "tool_call_response":
        return this.handleToolResponse(event);
      case "llm_completion_response":
        return this.handleLLMCompletionResponse(event);
      default:
        return err(`agent cannot handle ${event.event_type}`);
    }
  }

  // ── Input events: history write → completion request ─────────────────────

  private handleMessage(event: MessageEvent): Result<Array<Event>, string> {
    this.history.push({ role: "user", content: event.content });
    return ok(this.requestCompletion());
  }

  private handleAgentMessage(event: AgentMessageEvent): Result<Array<Event>, string> {
    this.history.push({
      role: "user",
      content: text(`<agent_message>
					<from_agent_id>${event.from_agent_id}</from_agent_id>
					<content>${event.content}</content>
				</agent_message>`),
    });
    return ok(this.requestCompletion());
  }

  private handleApiCallback(event: ApiCallbackEvent): Result<Array<Event>, string> {
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
    return ok(this.requestCompletion());
  }

  private handleToolResponse(event: ToolResponseEvent): Result<Array<Event>, string> {
    this.history.push({
      role: "tool",
      tool_call_id: event.tool_call_id,
      name: event.name,
      content: event.content,
    });
    --this.waitingForToolCallCount;
    return ok(this.waitingForToolCallCount === 0 ? this.requestCompletion() : []);
  }

  private handleLLMCompletionResponse(
    event: LLMCompletionResponse,
  ): Result<Array<Event>, string> {
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
    return ok(events);
  }

  /** The agent cannot call a provider itself: it asks the orchestrator to. */
  private requestCompletion(): Array<Event> {
    return [
      {
        id: nanoid(10),
        event_type: "llm_completion_request",
        from_agent_id: this.id,
      },
    ];
  }
}
