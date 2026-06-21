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
import type { FileSystem } from "@/application/filesystem/model";

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

  private agentDir?: string;
  private fs?: FileSystem;

  private constructor(
    id: string,
    template: Template,
    history: Array<HistoryEntry>,
  ) {
    this.id = id;
    this.template = template;
    this.history = history;
  }

  setPersistContext(fs: FileSystem, agentDir: string): void {
    this.fs = fs;
    this.agentDir = agentDir;
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

  async handleMessage(event: MessageEvent): Promise<Array<Event>> {
    this.history.push({
      role: "user",
      content: event.content,
    });
    await this.fs?.writeFile(
      `${this.agentDir}${this.id}.json`,
      JSON.stringify(this.serialize()),
    );
    return [
      {
        id: nanoid(10),
        event_type: "llm_completion_request",
        from_agent_id: this.id,
        history: this.history,
      },
    ];
  }

  async handleAgentMessage(event: AgentMessageEvent): Promise<Array<Event>> {
    this.history.push({
      role: "user",
      content: `<agent_message>
					<from_agent_id>${event.from_agent_id}</from_agent_id>
					<content>${event.content}</content>
				</agent_message>`,
    });
    await this.fs?.writeFile(
      `${this.agentDir}${this.id}.json`,
      JSON.stringify(this.serialize()),
    );
    return [
      {
        id: nanoid(10),
        event_type: "llm_completion_request",
        from_agent_id: this.id,
        history: this.history,
      },
    ];
  }

  async handleApiCallback(event: ApiCallbackEvent): Promise<Array<Event>> {
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
    await this.fs?.writeFile(
      `${this.agentDir}${this.id}.json`,
      JSON.stringify(this.serialize()),
    );
    return [
      {
        id: nanoid(10),
        event_type: "llm_completion_request",
        from_agent_id: this.id,
        history: this.history,
      },
    ];
  }

  async handleToolResponse(event: ToolResponseEvent): Promise<Array<Event>> {
    this.history.push({
      role: "tool",
      tool_call_id: event.tool_call_id,
      name: event.name,
      content: event.content,
    });
    --this.waitingForToolCallCount;
    await this.fs?.writeFile(
      `${this.agentDir}${this.id}.json`,
      JSON.stringify(this.serialize()),
    );
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

  async handleLLMCompletionResponse(
    event: LLMCompletionResponse,
  ): Promise<Array<Event>> {
    this.history.push({
      role: "assistant",
      content: event.content,
      tool_calls: event.tool_calls,
    });
    this.waitingForToolCallCount = event.tool_calls ? event.tool_calls.length : 0;
    await this.fs?.writeFile(
      `${this.agentDir}${this.id}.json`,
      JSON.stringify(this.serialize()),
    );
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
