import type { JsonValue } from "type-fest";
import { type EffectKindDefinition, defineNode, type Transition } from "@arbetslag/kernel";
import { z } from "zod";
import { AGENT_NAME, agentConfigSchema } from "./agent.ts";
import { CONVERSATION_NAME } from "./conversation.ts";
import {
	APPEND_PORT,
	HISTORY_PORT,
	type ToolCallBlock,
	type ToolResultBlock,
	USER_PORT,
	toolResult,
	toolResultBlockSchema,
} from "./history.ts";
import { type AgentLayoutOptions, placeAgent } from "./template.ts";
import { TOOL_RESULT_PORT, type ToolNode, toolPort } from "./tool.ts";

const jsonSchema: z.ZodType<JsonValue> = z.json();

/** 子 agent 的超时用这个效果种类；宿主里要有它的 **Performer**（`@arbetslag/host-node` 有）。 */
export const TIMER_WAIT = "timer.wait";

/**
 * 这个效果种类的声明归**发出它的人**：agents 包发它，所以声明在这里；
 * 实现（真的等一段时间）是宿主的事（ADR-0009 的两种词汇）。
 */
export const timerWaitKind: EffectKindDefinition = {
	kind: TIMER_WAIT,
	input: z.object({ ms: z.number().int().nonnegative() }),
	result: z.null(),
};

/** 子 agent 的一份模板片段：agent 的定义 + config，以及它自己的工具（ADR-0009）。 */
export const subagentFragmentSchema = z.object({
	agent: z.object({
		definition: z.string().min(1).default(AGENT_NAME),
		config: agentConfigSchema,
	}),
	tools: z
		.array(
			z.object({
				id: z.string().min(1),
				definition: z.string().min(1),
				config: jsonSchema,
				/** agent config 里那份 spec 的名字，端口名从它来。 */
				name: z.string().min(1),
			}),
		)
		.default([]),
});

export type SubagentFragment = z.infer<typeof subagentFragmentSchema>;

/** 从同一份 `agentLayout` 选项推出片段：作者写的还是那一份（工具名只写一遍）。 */
export function subagentFragment(options: AgentLayoutOptions): SubagentFragment {
	const placed = placeAgent(options);
	return {
		agent: { definition: placed.definition, config: placed.config },
		tools: placed.tools,
	};
}

const subagentStateSchema = z
	.object({
		/** `callId` → 这个调用的子 agent。结束了就从这里删掉——这就是幂等的判据。 */
		children: z
			.record(z.string(), z.object({ childId: z.string(), phase: z.enum(["spawning", "running"]), task: z.string() }))
			.default({}),
		/** 起过几个子 agent：给节点 id 用，也是可观察的计数。 */
		spawned: z.number().int().nonnegative().default(0),
	})
	.default({ children: {}, spawned: 0 });

const subagentConfigSchema = z.object({
	fragment: subagentFragmentSchema,
	/** 子 agent 多久不回就当超时；超时回一条失败结果，不拖住父 agent。 */
	timeoutMs: z.number().int().positive(),
});

export type SubagentState = z.infer<typeof subagentStateSchema>;
export type SubagentConfig = z.infer<typeof subagentConfigSchema>;

export type SubagentOptions = {
	name: string;
	description: string;
	/** 模型给的调用参数。 */
	input: z.ZodType<JsonValue>;
};

/** 子 agent 的 conversation 用这个相对后缀；实际节点 id 是 `${childId}.conversation`。 */
const conversationIdOf = (childId: string): string => `${childId}.conversation`;

/** 起一个子 agent 的那批操作：新增节点 + 接线（ADR-0002、0009、0010）。 */
function spawnOps(self: string, childId: string, fragment: SubagentFragment): JsonValue[] {
	const conversationId = conversationIdOf(childId);
	const ops: JsonValue[] = [
		{
			op: "spawn",
			id: childId,
			definition: fragment.agent.definition,
			config: fragment.agent.config,
		},
		// 子 agent 的 history 和自己的 conversation 成对起（ADR-0010）。
		{ op: "spawn", id: conversationId, definition: CONVERSATION_NAME, config: null },
		{ op: "connect", from: conversationId, to: childId, port: HISTORY_PORT },
		{ op: "connect", from: childId, to: conversationId, port: APPEND_PORT },
	];
	for (const tool of fragment.tools) {
		ops.push({
			op: "spawn",
			id: `${childId}.${tool.id}`,
			definition: tool.definition,
			config: tool.config,
		});
		ops.push({ op: "connect", from: childId, to: `${childId}.${tool.id}`, port: toolPort(tool.name) });
		ops.push({ op: "connect", from: `${childId}.${tool.id}`, to: childId, port: TOOL_RESULT_PORT });
	}
	// 子 agent 的回复回到我这里，我才知道它说完了（ADR-0009：`reply` 回边）。
	ops.push({ op: "connect", from: childId, to: self, port: "reply" });
	return ops;
}

/** 回收一个子 agent：连带它的 conversation 与工具，边一并删掉（`retire` 的语义）。 */
function retireOps(childId: string, fragment: SubagentFragment): JsonValue[] {
	return [childId, conversationIdOf(childId), ...fragment.tools.map((tool) => `${childId}.${tool.id}`)].map(
		(id) => ({ op: "retire", id }),
	);
}

const without = (children: SubagentState["children"], callId: string): SubagentState["children"] => {
	const { [callId]: _gone, ...rest } = children;
	return rest;
};

const callIdOf = (state: SubagentState, childId: string | undefined): string | undefined =>
	Object.keys(state.children).find((callId) => state.children[callId]?.childId === childId);

/**
 * subagent 是工具节点的一种（ADR-0009）：收到调用就 spawn 一个子 agent、把任务发给它、
 * 起一个超时；子 agent 回复就回收它并沿 `tool.result` 把结果交给父 agent。
 *
 * 两条结束路径（回复 / 超时）都先看 `callId` 还在不在：处理过的直接忽略，
 * 所以竞态下不会重复回结果。
 */
export function defineSubagent(options: SubagentOptions): ToolNode {
	const callPort = toolPort(options.name);
	const node = defineNode<SubagentState, SubagentConfig>({
		name: options.name,
		version: 1,
		state: subagentStateSchema,
		config: subagentConfigSchema,
		ports: () => ({
			/** 发给子 agent 的话：它的 conversation 收到的类别是 `user`（端口名就是类别）。 */
			[USER_PORT]: z.object({ text: z.string() }),
			/** 子 agent 的回复（`from` 是哪个子 agent）。 */
			reply: z.object({ text: z.string() }),
			[TOOL_RESULT_PORT]: toolResultBlockSchema,
		}),
		step: ({ self, state, config, message }): Transition<SubagentState> => {
			switch (message.type) {
				case callPort: {
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

					const spawned = state.spawned + 1;
					const childId = `${self}.child${spawned}`;
					const task = (parsed.data as { task?: string }).task ?? "";
					return {
						state: {
							spawned,
							children: {
								...state.children,
								[call.callId]: { childId, phase: "spawning", task },
							},
						},
						effects: [
							{
								kind: "graph.mutate",
								input: { ops: spawnOps(self, childId, config.fragment) },
								correlationId: `spawn:${call.callId}`,
							},
						],
					};
				}

				case "@effect.end": {
					const { correlationId, result } = message.body as {
						correlationId: string;
						result: { ok: boolean; error?: string };
					};

					if (correlationId.startsWith("spawn:")) {
						const callId = correlationId.slice("spawn:".length);
						const child = state.children[callId];
						if (child === undefined) return { state }; // 已经结束了（比如超时先到）

						if (!result.ok) {
							// 改图没成：没有子 agent，也没有要回收的东西，回一条失败结果。
							const failure = toolResult({
								callId,
								name: options.name,
								ok: false,
								result: { error: result.error ?? "spawn failed" },
							});
							return {
								state: { ...state, children: without(state.children, callId) },
								sends: [{ port: TOOL_RESULT_PORT, body: failure }],
							};
						}

						// 节点在图上存在了，才能把任务发给它（ADR-0009：要等回执）。
						return {
							state: {
								...state,
								children: { ...state.children, [callId]: { ...child, phase: "running" } },
							},
							sends: [{ port: USER_PORT, to: conversationIdOf(child.childId), body: { text: child.task } }],
							effects: [
								{
									kind: TIMER_WAIT,
									input: { ms: config.timeoutMs },
									correlationId: `timeout:${callId}`,
								},
							],
						};
					}

					if (correlationId.startsWith("timeout:")) {
						const callId = correlationId.slice("timeout:".length);
						const child = state.children[callId];
						if (child === undefined) return { state }; // 子 agent 已经回复过了
						const failure = toolResult({
							callId,
							name: options.name,
							ok: false,
							result: { error: `subagent timed out after ${config.timeoutMs}ms` },
						});
						return {
							state: { ...state, children: without(state.children, callId) },
							sends: [{ port: TOOL_RESULT_PORT, body: failure }],
							effects: [
								{
									kind: "graph.mutate",
									input: { ops: retireOps(child.childId, config.fragment) },
									correlationId: `retire:${callId}`,
								},
							],
						};
					}

					// `retire:` 的回执：该做的都做完了，没有后续。
					return { state };
				}

				case "reply": {
					// 子 agent 说完了：`from` 告诉我是哪一个。
					const callId = callIdOf(state, message.from);
					if (callId === undefined) return { state }; // 超时先到、已经回收过了
					const child = state.children[callId];
					if (child === undefined) return { state };

					const body = message.body as { text: string };
					const answered: ToolResultBlock = toolResult({
						callId,
						name: options.name,
						result: { text: body.text },
					});
					return {
						state: { ...state, children: without(state.children, callId) },
						sends: [{ port: TOOL_RESULT_PORT, body: answered }],
						effects: [
							{
								kind: "graph.mutate",
								input: { ops: retireOps(child.childId, config.fragment) },
								correlationId: `retire:${callId}`,
							},
						],
					};
				}

				default:
					return { state };
			}
		},
	});

	const tool = { name: options.name, description: options.description, input: options.input };
	return Object.assign(node, { tool });
}
