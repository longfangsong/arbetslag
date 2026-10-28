import type { JsonValue } from "type-fest";
import { z } from "zod";
import {
	type AnyNodeDefinition,
	type NodeDefinition,
	defineNode,
	type Transition,
} from "@arbetslag/kernel";
import { type ToolCallBlock, toolResult, toolResultBlockSchema } from "./history.ts";

// 与内核一致：zod 的 `JSONType` 与 type-fest 的 `JsonValue` 不是同一个类型。
const anyJson: z.ZodType<JsonValue> = z.json();

/** 抄进 agent config、再交给模型的那份描述。厂商无关，就是 JSON Schema（ADR-0009）。 */
export const toolSpecSchema = z.object({
	name: z.string().min(1),
	description: z.string(),
	/** `input` 的 JSON Schema：构建模板时从 zod 定义转出来。 */
	input: anyJson,
});

export type ToolSpec = z.infer<typeof toolSpecSchema>;

/** 工具节点定义上挂的元数据：名字、描述、input schema（ADR-0009）。 */
export type ToolDefinition = {
	name: string;
	description: string;
	input: z.ZodType<JsonValue>;
};

/** 工具节点的输出端口名 = 它发回 agent 的消息类别。 */
export const TOOL_RESULT_PORT = "tool.result";

/**
 * agent 调一个工具用的端口名，同时也是工具收到的**消息类别**（ADR-0005：端口名就是类别）。
 * 两边都从这里取，名字就不会漂。
 */
export const toolPort = (name: string): string => `tool.${name}`;

/** 一种工具节点：普通节点定义 + 一份元数据（ADR-0009）。 */
export type ToolNode = AnyNodeDefinition & { tool: ToolDefinition };

export type ToolRun<State, Config> = (input: {
	call: ToolCallBlock;
	state: State;
	config: Config;
}) => ToolOutcome<State>;

export type ToolOutcome<State> = {
	state: State;
	result: JsonValue;
	/** 省略即成功。失败也走结果端口，`ok: false`（ADR-0006）。 */
	ok?: boolean;
};

export type ToolOptions<State extends JsonValue, Config extends JsonValue> = {
	name: string;
	description: string;
	/** 模型给的 `input` 必须过这一关；不合规就回一条 `ok: false` 的结果。 */
	input: z.ZodType<JsonValue>;
	state: z.ZodType<State>;
	config: z.ZodType<Config>;
	/**
	 * 收到一次调用之后干什么。**同步、纯**：工具若要出效果（联网、读写），
	 * 就自己写节点定义，不要用这个 helper（ADR-0004）。
	 */
	run: ToolRun<State, Config>;
};

/**
 * 定义一个工具节点（ADR-0009）：端口只有 `tool.result`，收到 `tool-call` 就回一条结果。
 *
 * 它同时是节点定义、又带元数据；`agentLayout` 会用元数据把 schema 抄进 agent 的 config。
 */
export function defineTool<State extends JsonValue, Config extends JsonValue>(
	options: ToolOptions<State, Config>,
): ToolNode {
	const node: NodeDefinition<State, Config> = defineNode<State, Config>({
		name: options.name,
		version: 1,
		state: options.state,
		config: options.config,
		ports: (): Record<string, z.ZodType<JsonValue>> => ({
			[TOOL_RESULT_PORT]: toolResultBlockSchema,
		}),
		step: ({ state, config, message }): Transition<State> => {
			// 端口名就是消息类别：收到的是 `tool.<name>`，不是笼统的 `tool-call`。
			if (message.type !== toolPort(options.name)) return { state };
			const call = message.body as ToolCallBlock;
			const parsed = options.input.safeParse(call.input);
			if (!parsed.success) {
				const failure = toolResult({
					callId: call.callId,
					name: options.name,
					ok: false,
					result: { error: `invalid input: ${parsed.error.message}` },
				});
				return { state, sends: [{ port: TOOL_RESULT_PORT, body: failure }] };
			}
			const outcome = options.run({ call: { ...call, input: parsed.data }, state, config });
			const result = toolResult({
				callId: call.callId,
				name: options.name,
				ok: outcome.ok ?? true,
				result: outcome.result,
			});
			return { state: outcome.state, sends: [{ port: TOOL_RESULT_PORT, body: result }] };
		},
	});

	return Object.assign(node, {
		tool: { name: options.name, description: options.description, input: options.input },
	});
}

/** 抄进 config 的那份描述；`input` 是 zod → JSON Schema（构建期做一次）。 */
export function toolSpec(tool: ToolDefinition): ToolSpec {
	// `$schema` 对模型没用，徒增 token；其余原样交给模型。
	const { $schema: _schema, ...input } = z.toJSONSchema(tool.input) as { $schema?: string } & Record<
		string,
		JsonValue
	>;
	return { name: tool.name, description: tool.description, input };
}
