import { contentText, type HistoryEntry } from "@/application/agent/history";

/** `contentText` needs Content; tool/assistant entries carry a plain string. */
export function entryText(entry: HistoryEntry): string {
	return typeof entry.content === "string" ? entry.content : contentText(entry.content);
}
