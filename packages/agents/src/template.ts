import type { JsonValue } from "type-fest";
import type { WorkflowTemplate } from "@arbetslag/kernel";
import { AGENT_NAME, type AgentConfig } from "./agent.ts";
import { TOOL_RESULT_PORT, type ToolNode, toolPort, toolSpec } from "./tool.ts";

/** 一个工具实例：哪份定义 + 它的 config（+ 可选的 id）。 */
export type ToolBinding = {
	tool: ToolNode;
	config?: JsonValue;
	/** **相对** id，默认就是工具名；实际节点 id 是 `${agent}.${id}`。 */
	id?: string;
};

export type AgentLayoutOptions = {
	agent: string;
	/** 默认 agents 包里的 `agent`。 */
	definition?: string;
	/** 端口从 `tools` 推出来，所以这里不含 `tools`（ADR-0009）。 */
	config: Omit<AgentConfig, "tools">;
	tools?: ToolBinding[];
};

export type AgentLayout = {
	nodes: NonNullable<WorkflowTemplate["nodes"]>;
	edges: NonNullable<WorkflowTemplate["edges"]>;
};

/** 一个工具在模板里的落点：相对 id、定义名、config、以及它的名字（端口名从它来）。 */
export type ToolPlacement = {
	id: string;
	definition: string;
	config: JsonValue;
	name: string;
};

/**
 * 构建期唯一同时看得到两边定义的时刻（ADR-0009）：把工具的 schema 抄进 agent 的 config，
 * 同时算出工具的落点。`agentLayout`（写进模板）和 subagent 片段（写进 config）共用这一份。
 */
export function placeAgent(options: AgentLayoutOptions): {
	definition: string;
	config: AgentConfig;
	tools: ToolPlacement[];
} {
	const tools = options.tools ?? [];
	return {
		definition: options.definition ?? AGENT_NAME,
		config: { ...options.config, tools: tools.map((binding) => toolSpec(binding.tool.tool)) },
		tools: tools.map((binding) => ({
			id: binding.id ?? binding.tool.tool.name,
			definition: binding.tool.name,
			config: binding.config ?? null,
			name: binding.tool.tool.name,
		})),
	};
}

/**
 * 把工具一次写清（ADR-0009）：schema 抄进 agent 的 config，
 * 同时生成「agent → 工具」「工具 → agent」两条边。作者只写一遍工具名。
 *
 * `reply` 端口不接线：交给调用方（那个端口通向哪儿是应用的事）。
 */
export function agentLayout(options: AgentLayoutOptions): AgentLayout {
	const placed = placeAgent(options);
	const nodes: AgentLayout["nodes"] = {
		[options.agent]: { definition: placed.definition, config: placed.config },
	};
	const edges: AgentLayout["edges"] = [];

	for (const tool of placed.tools) {
		const toolId = `${options.agent}.${tool.id}`;
		nodes[toolId] = { definition: tool.definition, config: tool.config };
		edges.push(
			{ from: options.agent, to: toolId, port: toolPort(tool.name) },
			{ from: toolId, to: options.agent, port: TOOL_RESULT_PORT },
		);
	}

	return { nodes, edges };
}
