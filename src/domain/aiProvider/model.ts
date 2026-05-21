import { Config, MutableState as State, ToolExecutionContext } from "@/application/orchestrator";
import { Agent } from "../agent/model";
import { Tool } from "../tool/model";
import { nanoid } from "nanoid";
import { ToolCallEvent } from "@/domain/event/model";

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

export async function complete(
	config: Config,
	state: State,
	agent: Agent,
): Promise<State> {
	const provider = config.aiProviders.find(
		(p) => p.name === agent.template.ai_provider,
	);
	if (!provider) {
		throw new Error(`AI provider ${agent.template.ai_provider} not found`);
	}
	const allowedTools = config.toolRepository.tools.filter(
		(tool: Tool<unknown, unknown, unknown>) =>
			agent.template.allowedTools.includes(tool.name),
	);
	const response = await provider.complete(
		agent.template.model,
		agent.history,
		allowedTools,
	);
	agent.history.push(response);
	if (response.content) {
		await agent.outputHandler.handle(state, agent, response.content);
	}
	if (response.tool_calls) {
		for (const tool_call of response.tool_calls) {
			state.eventQueue.push({
				id: tool_call.id || nanoid(10),
				to_agent_id: agent.id,
				event_type: "tool_call",
				payload: tool_call,
			} as ToolCallEvent);
		}
	}
	return state;
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
