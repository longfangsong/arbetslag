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
	usage?: { prompt_tokens: number };
}

export type ContentPart =
	| { type: "text"; text: string }
	| { type: "image"; url: string };

export type Content = Array<ContentPart>;

export function imageCount(content: Content): number {
	return content.filter((p) => p.type === "image").length;
}

export function text(s: string): Content {
	return [{ type: "text", text: s }];
}

export function contentText(content: Content): string {
	return content
		.filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
		.map((p) => p.text)
		.join("\n");
}

export type HistoryEntry =
	| {
			role: "system" | "user";
			content: Content;
	  }
	| ToolCallResult
	| CompletionResult;

export function hasToolCalls(
	entry: HistoryEntry,
): entry is CompletionResult & { tool_calls: Array<ToolCall> } {
	return entry.role === "assistant" && entry.tool_calls !== undefined;
}
