import { JsonValue } from "type-fest";

export type ToolCall = {
  id?: string;
  toolName: string;
  arguments: Record<string, JsonValue>;
}

export type ToolCallResult = {
  role: "tool";
  toolCallId?: string;
  name: string;
  content: string;
}

export type CompletionResult = {
  role: "assistant";
  content: string;
  toolCalls?: Array<ToolCall>;
  usage?: { promptTokens: number };
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
    .filter(
      (p): p is Extract<ContentPart, { type: "text" }> => p.type === "text",
    )
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
): entry is CompletionResult & { toolCalls: Array<ToolCall> } {
  return entry.role === "assistant" && entry.toolCalls !== undefined;
}

export type History = {
  id: string;
  entries: Array<HistoryEntry>;
}