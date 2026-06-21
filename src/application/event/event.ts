import { HistoryEntry, ToolCall } from "../agent/history";

export interface ToolCallRequest {
	id: string;
	event_type: "tool_call_request";

	from_agent_id: string;

	tool_call: ToolCall;
}

export interface MessageEvent {
	id: string;
	event_type: "message";

	chat_id: string;

	adapter: string;
	content: string;
}

export interface ToolResponseEvent {
	id: string;
	event_type: "tool_call_response";

	to_agent_id: string;

	tool_call_id?: string;
	name: string;
	content: string;
}

export interface AgentMessageEvent {
	id: string;
	event_type: "agent_message";

	from_agent_id: string;
	to_agent_id: string;

	content: string;
}

export interface ApiCallbackEvent {
	id: string;
	event_type: "api_callback";

	to_agent_id?: string;

	api_name: string;
	content: string;
}

export interface LLMCompletionRequest {
	id: string;
	event_type: "llm_completion_request";
	
	from_agent_id: string;
	
	history: Array<HistoryEntry>
}

export interface LLMCompletionResponse {
	id: string;
	event_type: "llm_completion_response";
	
	to_agent_id: string;
	
	content: string;
	tool_calls?: Array<ToolCall>;
}

export interface AgentOutput {
	id: string;
	event_type: "agent_output";
	
	from_agent_id: string;
	content: string;
}

export type Event =
	| ToolCallRequest
	| MessageEvent
	| AgentMessageEvent
	| ToolResponseEvent
	| ApiCallbackEvent
	| LLMCompletionRequest
	| LLMCompletionResponse
	| AgentOutput;
