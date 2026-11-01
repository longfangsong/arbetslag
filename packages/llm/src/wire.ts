import type { JsonValue } from "type-fest";
import type { AnyNodeDefinition, WorkflowTemplate } from "@arbetslag/kernel";
import { LLM_NAME, type LlmConfig } from "./llm.ts";
import { TOOL_RESULT_PORT, type ToolProvider, providesTools, toolPort, toolSpec } from "./tool.ts";

/** 一个提供工具的节点实例：哪份定义 + 它的 config（+ 可选的 id）。 */
export type ToolBinding = {
	node: ToolProvider;
	config?: JsonValue;
	/** **相对** id，默认是定义名；实际节点 id 是 `${llm}.${id}`。 */
	id?: string;
};

export type WireToolsOptions = {
	/** LLM 节点的 id。 */
	llm: string;
	/** 默认本包的 `llm`。 */
	definition?: string;
	/** 端口从工具推出来，所以这里不含 `tools`（ADR-0009）。 */
	config: Omit<LlmConfig, "tools">;
	tools?: ToolBinding[];
};

export type WiredTools = {
	nodes: NonNullable<WorkflowTemplate["nodes"]>;
	edges: NonNullable<WorkflowTemplate["edges"]>;
};

export class NotAToolProvider extends Error {
	constructor(definition: string, reason: string) {
		super(`node definition ${definition} cannot be wired as a tool: ${reason}`);
		this.name = "NotAToolProvider";
	}
}

/**
 * 构建期唯一同时看得到两边定义的时刻（ADR-0009）：用各自的 config 求出节点提供的工具，
 * 把描述抄进 LLM 节点的 config，同时接好「LLM 节点 → 节点」（每个工具一条）与「节点 → LLM 节点」两个方向。
 * 作者只写一遍。
 *
 * 没提供工具、或者没有 `tool.result` 端口回结果的节点，在这里就报错。
 * `reply` 端口不接线：交给调用方（那个端口通向哪儿是应用的事）。
 */
export function wireTools(options: WireToolsOptions): WiredTools {
	const nodes: WiredTools["nodes"] = {};
	const edges: WiredTools["edges"] = [];
	const specs: LlmConfig["tools"] = [];
	const names = new Set<string>();

	for (const binding of options.tools ?? []) {
		// 类型上已经要求提供工具；运行时再查一遍，挡住绕过类型（`as`、JS 调用方）交进来的定义。
		const node: AnyNodeDefinition = binding.node;
		if (!providesTools(node)) throw new NotAToolProvider(node.name, "it provides no tools");
		const config = binding.config ?? null;
		if (!(TOOL_RESULT_PORT in node.ports(node.config.parse(config)))) {
			throw new NotAToolProvider(node.name, `it has no ${TOOL_RESULT_PORT} port to answer on`);
		}
		const tools = node.tools(config);
		if (tools.length === 0) throw new NotAToolProvider(node.name, "it provides no tools under this config");

		const id = `${options.llm}.${binding.id ?? node.name}`;
		nodes[id] = { definition: node.name, config };
		for (const tool of tools) {
			if (names.has(tool.name)) throw new NotAToolProvider(node.name, `tool ${tool.name} is provided twice`);
			names.add(tool.name);
			specs.push(toolSpec(tool));
			edges.push({ from: options.llm, to: id, port: toolPort(tool.name) });
		}
		edges.push({ from: id, to: options.llm, port: TOOL_RESULT_PORT });
	}

	return {
		nodes: {
			[options.llm]: { definition: options.definition ?? LLM_NAME, config: { ...options.config, tools: specs } },
			...nodes,
		},
		edges,
	};
}
