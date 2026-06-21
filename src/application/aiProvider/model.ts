import { Tool } from "../tool/model";
import { CompletionResult, HistoryEntry } from "./history";


export interface AIProvider {
	name: string;
	complete(
		model: string,
		history: Array<HistoryEntry>,
		allowedTools: Array<Tool<unknown, unknown, unknown>>,
	): Promise<CompletionResult>;
}
