export interface ToolCall {
	id?: string;
	tool_name: string;
	arguments: Record<string, any>;
}

export interface ToolCallResult {
	role: "tool";
	tool_call_id?: string;
	name: string;
	content: string;
}

export interface CompletionResult {
	role: "assistant";
	content: string;
	tool_calls?: Array<ToolCall>;
}

export type HistoryEntry =
	| {
			role: "system" | "user";
			content: string;
	  }
	| ToolCallResult
	| CompletionResult;