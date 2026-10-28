import type { JsonValue } from "type-fest";
import { defineNode, type Transition } from "@arbetslag/kernel";
import { z } from "zod";
import {
	type HistoryMessage,
	type ToolResultBlock,
	historyMessageSchema,
	historySchema,
	text,
	textOf,
	toolCallBlockSchema,
	toolCallsOf,
	toolResultBlockSchema,
} from "./history.ts";
import { type ModelCompleteInput, type ModelCompleteResult, modelCompleteKind } from "./modelComplete.ts";
import { TOOL_RESULT_PORT, toolPort, toolSpecSchema } from "./tool.ts";

const jsonSchema: z.ZodType<JsonValue> = z.json();

/** agent 的私有状态（ADR-0009）。等待是 state 里的集合，不是内核机制（ADR-0007）。 */
export const agentStateSchema = z.object({
	history: historySchema.default([]),
	/** 正在等的模型调用（`correlationId`）；有值就不发新的。 */
	modelCall: z.string().optional(),
	/** 正在等的工具调用：`callId` → 工具名。集合空了才发下一次模型调用。 */
	pending: z.record(z.string(), z.string()).default({}),
	/** 生成 `correlationId` 的单调计数。 */
	nextCall: z.number().int().nonnegative().default(0),
}).default({ history: [], pending: {}, nextCall: 0 });

/**
 * agent 的 config：型号、系统提示、工具清单（构建期由 `agentLayout` 抄好）、厂商参数。
 * 端口由它推出来（ADR-0009）：`reply` + 每个工具一个 `tool.<name>`。
 */
export const agentConfigSchema = z.object({
	model: z.string().min(1),
	system: z.string().optional(),
	tools: z.array(toolSpecSchema).default([]),
	params: jsonSchema.optional(),
});

export type AgentState = z.infer<typeof agentStateSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const AGENT_NAME = "agent";

/** 发给 agent 的输入：用户说的话。 */
const userBodySchema = z.object({ text: z.string() });
/** agent 的回复：文本 + 那条 assistant 消息（下游想用整条就用整条）。 */
const replyBodySchema = z.object({ text: z.string(), message: historyMessageSchema });

const waiting = (state: AgentState): boolean =>
	state.modelCall !== undefined || Object.keys(state.pending).length > 0;

/**
 * 没有在等的东西才问下一次：把 `correlationId` 记进 state，同时交出效果。
 * `system` 每次都前置，但不进 history（history 只记对话）。
 */
function ask(state: AgentState, config: AgentConfig): Transition<AgentState> {
	if (waiting(state)) return { state };
	const nextCall = state.nextCall + 1;
	const correlationId = `m${nextCall}`;
	const messages: HistoryMessage[] = [];
	if (config.system !== undefined) messages.push({ role: "system", blocks: [text(config.system)] });
	messages.push(...state.history);
	const input: ModelCompleteInput = {
		model: config.model,
		messages,
		tools: config.tools,
		...(config.params === undefined ? {} : { params: config.params }),
	};
	return {
		state: { ...state, modelCall: correlationId, nextCall },
		effects: [{ kind: modelCompleteKind.kind, input, correlationId }],
	};
}

/**
 * agent（ADR-0009）：普通节点定义，循环在图里，不在函数里。
 *
 * - 收到 `user` → 记进 history，没有在等的东西就交出一个 `model.complete`；
 * - 收到回执 → 有工具调用就各发一条 `tool.<name>`、把 `callId` 记进 `pending`；没有就沿 `reply` 回话；
 * - 收到 `tool.result` → 记进 history、从 `pending` 删掉；空了就问下一次。
 *
 * 每次转移只做一步，所以每一步都能落盘、被观察、被重放（ADR-0004、0007）。
 */
export const agent = defineNode<AgentState, AgentConfig>({
	name: AGENT_NAME,
	version: 1,
	state: agentStateSchema,
	config: agentConfigSchema,
	ports: (config) => ({
		reply: replyBodySchema,
		[TOOL_RESULT_PORT]: toolResultBlockSchema,
		...Object.fromEntries(config.tools.map((tool) => [`tool.${tool.name}`, toolCallBlockSchema])),
	}),
	step: ({ state, config, message }) => {
		switch (message.type) {
			case "user": {
				const body = userBodySchema.parse(message.body);
				return ask(
					{ ...state, history: [...state.history, { role: "user", blocks: [text(body.text)] }] },
					config,
				);
			}

			case TOOL_RESULT_PORT: {
				const block = message.body as ToolResultBlock;
				// 重复的结果、认不出的 callId：幂等忽略（两条结束路径都可能重复，ADR-0009）。
				if (state.pending[block.callId] === undefined) return { state };
				const pending = { ...state.pending };
				delete pending[block.callId];
				return ask(
					{ ...state, history: [...state.history, { role: "tool", blocks: [block] }], pending },
					config,
				);
			}

			case "@effect.end": {
				const body = message.body as { correlationId: string; result: ModelCompleteResult };
				// 不是我正在等的那个（或重复回执）：忽略。
				if (body.correlationId !== state.modelCall) return { state };

				const cleared: AgentState = { ...state, modelCall: undefined };
				if (!body.result.ok) {
					const reply = `（模型调用失败：${body.result.error}）`;
					const message: HistoryMessage = { role: "assistant", blocks: [text(reply)] };
					return {
						state: { ...cleared, history: [...cleared.history, message] },
						sends: [{ port: "reply", body: { text: reply, message } }],
					};
				}

				const answer = body.result.message;
				const calls = toolCallsOf(answer);
				const history = [...cleared.history, answer];

				if (calls.length === 0) {
					const reply = textOf(answer);
					const next: AgentState = { ...cleared, history };
					if (reply === "") return { state: next };
					return { state: next, sends: [{ port: "reply", body: { text: reply, message: answer } }] };
				}

				const sends: NonNullable<Transition<AgentState>["sends"]> = [];
				const pending: Record<string, string> = {};
				const failures: ToolResultBlock[] = [];
				for (const call of calls) {
					const known = config.tools.some((tool) => tool.name === call.name);
					if (!known) {
						// 模型点名了不存在的工具：当成一次失败的工具结果，让它自己改（不发到不存在的端口）。
						failures.push({
							type: "tool-result",
							callId: call.callId,
							name: call.name,
							ok: false,
							result: { error: `unknown tool: ${call.name}` },
						});
						continue;
					}
					pending[call.callId] = call.name;
					sends.push({ port: toolPort(call.name), body: call });
				}

				const next: AgentState = {
					...cleared,
					history: failures.length === 0 ? history : [...history, { role: "tool", blocks: failures }],
					pending,
				};
				// 一次都没接上（全是没听说过的工具）：不用等谁，直接让模型看一眼失败再问。
				if (Object.keys(pending).length === 0) return { ...ask(next, config), sends };
				return { state: next, sends };
			}

			default:
				return { state };
		}
	},
});
