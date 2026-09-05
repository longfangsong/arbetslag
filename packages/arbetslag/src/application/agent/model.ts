import { nanoid } from "nanoid";
import { Template } from "./template/model";
import { HistoryEntry } from "./history";
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
}

export class Agent {
  public readonly id: string;
  public readonly template: Template;
  public history: Array<HistoryEntry> = [];
  public chatId?: string;
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
    return new Agent(nanoid(10), template, []);
  }

  static deserialize(data: SerializedAgent): Agent {
    const agent = new Agent(data.id, data.template, data.history);
    if (data.chatId) agent.chatId = data.chatId;
    if (data.waitingForToolCallCount != null) agent.waitingForToolCallCount = data.waitingForToolCallCount;
    return agent;
  }

  serialize(): SerializedAgent {
    return {
      id: this.id,
      template: this.template,
      history: this.history,
      chatId: this.chatId,
      waitingForToolCallCount: this.waitingForToolCallCount,
    };
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
      content: `<agent_message>
					<from_agent_id>${event.from_agent_id}</from_agent_id>
					<content>${event.content}</content>
				</agent_message>`,
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
      content: `<api_callback>
					<id>${event.id}</id>
					<api_name>${event.api_name}</api_name>
					<payload>
						${event.content}
					</payload>
				</api_callback>`,
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
