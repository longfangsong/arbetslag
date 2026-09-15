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

/** One part of a multimodal (user) message: text or an image (http(s) URL or `data:` URI). */
export type ContentPart =
	| { type: "text"; text: string }
	| { type: "image"; url: string };

/** Extract the text of a message content; image parts contribute nothing. */
export function contentText(content: string | Array<ContentPart>): string {
	if (typeof content === "string") return content;
	return content
		.filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
		.map((p) => p.text)
		.join("\n");
}

export type HistoryEntry =
	| {
			role: "system" | "user";
			content: string | Array<ContentPart>;
	  }
	| ToolCallResult
	| CompletionResult;