export interface ToolCall {
	id: string;
	tool_name: string;
	arguments: Record<string, any>;
}

export interface ToolCallResult {
	role: "tool";
	tool_call_id: string;
	name: string;
	content: string;
}

export interface CompletionResult {
	role: "assistant";
	content: string;
	tool_calls?: Array<ToolCall>;
	usage?: { prompt_tokens: number };
}

/** One part of a multimodal (user) message: text or an image (http(s) URL or `data:` URI). */
export type ContentPart =
	| { type: "text"; text: string }
	| { type: "image"; url: string };

/** Message content: a list of content parts (a plain text message is a single text part). */
export type Content = Array<ContentPart>;

/** Count the image parts in a message content. */
export function countImages(content: Content): number {
	return content.filter((p) => p.type === "image").length;
}

/** Build content from plain text. */
export function text(s: string): Content {
	return [{ type: "text", text: s }];
}

/** Extract the text of a message content; image parts contribute nothing. */
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

export type AssistantEntry = Extract<HistoryEntry, { role: "assistant" }>;

/** Assistant entries are the only ones that may carry tool calls. */
export function hasToolCalls(
	entry: HistoryEntry,
): entry is AssistantEntry & { tool_calls: Array<ToolCall> } {
	return entry.role === "assistant" && entry.tool_calls !== undefined;
}

/** True when `toolCallId` answers a tool call in history that has no result yet. */
export function hasUnansweredToolCall(
	history: Array<HistoryEntry>,
	toolCallId: string,
): boolean {
	return (
		history.some((e) => hasToolCalls(e) && e.tool_calls.some((tc) => tc.id === toolCallId)) &&
		!history.some((e) => e.role === "tool" && e.tool_call_id === toolCallId)
	);
}
