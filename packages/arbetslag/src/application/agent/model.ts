import { nanoid } from "nanoid";
import { Template } from "./template/model";
import { HistoryEntry, text, contentText } from "./history";
import {
  AgentMessageEvent,
  ApiCallbackEvent,
  LLMCompletionResponse,
  MessageEvent,
  ToolResponseEvent,
  Event,
} from "@/application/event/event";

export interface SerializedAgent {
  id: string;
  template: Template;
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
  public history: Array<HistoryEntry> = [];
  public chatId?: string;

  /**
   * Real prompt_tokens of the last LLM response (see
   * docs/adr/0001-compact-token-metering.md): the orchestrator meters the
   * next request as this value plus an estimate of the history added since.
   * Public because the orchestrator meters the next request.
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
    // Legacy stored history may hold plain string content: normalize to a single text part.
    const history = data.history.map((entry) =>
      (entry.role === "system" || entry.role === "user") && typeof entry.content === "string"
        ? { ...entry, content: text(entry.content) }
        : entry,
    );
    const agent = new Agent(data.id, data.template, history);
    if (data.chatId) agent.chatId = data.chatId;
    if (data.waitingForToolCallCount != null) agent.waitingForToolCallCount = data.waitingForToolCallCount;
    if (data.lastPromptTokens != null) agent.lastPromptTokens = data.lastPromptTokens;
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
    };
  }

  // Invalidate the lastPromptTokens so that the next request will be metered with a new estimate.
  // Use when the history has been changed, e.g. after compaction.
  clearLastPromptTokens(): void {
    this.lastPromptTokens = undefined;
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
