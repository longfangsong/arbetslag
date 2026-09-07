import { z } from "zod";
import { Tool } from "../tool/model";
import { CompletionResult, HistoryEntry } from "../agent/history";


export interface AIProvider {
	name: string;
	complete(
		model: string,
		history: Array<HistoryEntry>,
		allowedTools: Array<Tool<unknown, unknown, unknown>>,
		outputSchema?: z.ZodType,
	): Promise<CompletionResult>;
}
