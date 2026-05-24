import { Config, MutableState as State, ToolExecutionContext } from "@/application/orchestrator";
import { Tool } from "@/domain/tool/model";

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

export interface AIProvider {
	name: string;
	complete(
		model: string,
		history: Array<HistoryEntry>,
		allowedTools: Array<Tool<unknown, unknown, unknown>>,
	): Promise<CompletionResult>;
}

/**
 * Extract the subset of State that tools need.
 * This enforces the invariant that tools only see what they need.
 */
export function toToolExecutionContext(
	config: Config,
	state: State,
): ToolExecutionContext {
	return {
		config: config.config,
		fileSystem: config.fileSystem,
		agentTemplateRepository: config.agentTemplateRepository,
		agentRepository: state.agentRepository,
		eventQueue: state.eventQueue,
		toolState: state.toolState,
	};
}
