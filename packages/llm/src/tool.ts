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

/** 抄进 LLM 节点 config、再交给模型的那份描述。厂商无关，就是 JSON Schema（ADR-0009）。 */
export const toolSpecSchema = z.object({
	name: z.string().min(1),
	description: z.string(),
	/** `input` 的 JSON Schema：构建模板时从 zod 定义转出来。 */
	input: anyJson,
});

export type ToolSpec = z.infer<typeof toolSpecSchema>;

/** 一个工具的描述：名字、说明、input schema（ADR-0009）。 */
export type ToolDefinition = {
	name: string;
	description: string;
	input: z.ZodType<JsonValue>;
};

/** 节点回结果用的输出端口名 = 它发回调用方的消息类别。 */
export const TOOL_RESULT_PORT = "tool.result";

/**
 * 调一个工具用的端口名，同时也是提供它的节点收到的**消息类别**（ADR-0005：端口名就是类别）。
 * 两边都从这里取，名字就不会漂。
 */
export const toolPort = (name: string): string => `tool.${name}`;

/**
 * 提供工具的节点定义：普通节点定义 + 「在这份 config 下提供哪些工具」（ADR-0009）。
 *
 * 提供工具即承诺调用协议：收到 `tool.<name>`（body 是调用块）就沿 `tool.result` 回一条结果块，
 * 带回同一个 `callId`；失败也回。回之前做什么（交出效果、等回执、改图）随它。
 */
export type ToolProvider = AnyNodeDefinition & { tools(config: JsonValue): ToolDefinition[] };

/**
 * 给任意节点定义附上它提供的工具。`tools` 是 config 的纯函数（与 `ports` 同理），
 * 拿到的是按 `definition.config` 解析过的 config。内核不认识这份东西，原样运行这份定义。
 */
export function provideTools<State extends JsonValue, Config extends JsonValue>(
	definition: NodeDefinition<State, Config>,
	tools: (config: Config) => ToolDefinition[],
): NodeDefinition<State, Config> & ToolProvider {
	return Object.assign(definition, { tools: (config: JsonValue) => tools(definition.config.parse(config)) });
}

export const providesTools = (definition: AnyNodeDefinition): definition is ToolProvider =>
	typeof (definition as Partial<ToolProvider>).tools === "function";

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
	 * 收到一次调用之后干什么。**同步、纯**：要出效果（联网、读写），
	 * 就自己写节点定义再 `provideTools`，不要用这个写法（ADR-0004）。
	 */
	run: ToolRun<State, Config>;
};

/**
 * 便捷写法（ADR-0009）：用一个同步纯函数写出一个只提供一个工具的节点。
 * 端口只有 `tool.result`，收到 `tool.<name>` 就回一条结果。它不是另一类东西，就是 `provideTools` 的一种用法。
 */
export function defineTool<State extends JsonValue, Config extends JsonValue>(
	options: ToolOptions<State, Config>,
): NodeDefinition<State, Config> & ToolProvider {
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

	return provideTools(node, () => [{ name: options.name, description: options.description, input: options.input }]);
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
