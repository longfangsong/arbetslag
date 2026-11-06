import type { JsonValue } from "type-fest";
import { defineNode, type Transition } from "@arbetslag/kernel";
import { z } from "zod";
import {
	APPEND_PORT,
	HISTORY_PORT,
	type History,
	type HistoryMessage,
	type ToolResultBlock,
	forModel,
	historyMessageSchema,
	historySchema,
	text,
	textOf,
	toolCallBlockSchema,
	toolCallsOf,
	toolResultBlockSchema,
	unanswered,
} from "./history.ts";
import { type ModelCompleteInput, type ModelCompleteResult, modelCompleteKind } from "./modelComplete.ts";
import { TOOL_RESULT_PORT, toolPort, toolSpecSchema } from "./tool.ts";

const jsonSchema: z.ZodType<JsonValue> = z.json();

/**
 * LLM 节点的私有状态（ADR-0009）：只剩「在等什么」，**不含 history**（history 在 conversation 里，ADR-0010）。
 */
export const llmStateSchema = z
	.object({
		/** 正在等的模型调用（`correlationId`）；有值就不发新的。 */
		modelCall: z.string().optional(),
		/** 正在等的工具调用：`callId` → 工具名。集合空了才等下一份 history 快照。 */
		pending: z.record(z.string(), z.string()).default({}),
		/** 生成 `correlationId` 的单调计数。 */
		nextCall: z.number().int().nonnegative().default(0),
		/** 上次问模型时 history 有几条：之后进来的 user / tool 消息都还没回（`unanswered`）。 */
		seen: z.number().int().nonnegative().optional(),
	})
	.default({ pending: {}, nextCall: 0 });

/**
 * LLM 节点的 config：型号、系统提示、工具清单（构建期由 `wireTools` 抄好）、厂商参数。
 * 端口由它推出来（ADR-0009）：`reply` + 每个工具一个 `tool.<name>`。
 */
export const llmConfigSchema = z.object({
	/** 部署里的模型端点名（ADR-0018）；省略时由 Performer 决定（部署里只有一个就用它）。 */
	provider: z.string().min(1).optional(),
	model: z.string().min(1),
	system: z.string().optional(),
	tools: z.array(toolSpecSchema).default([]),
	params: jsonSchema.optional(),
});

export type LlmState = z.infer<typeof llmStateSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;

export const LLM_NAME = "llm";

/** LLM 节点的回复：文本 + 那条 assistant 消息（下游想用整条就用整条）。 */
const replyBodySchema = z.object({ text: z.string(), message: historyMessageSchema });

const waiting = (state: LlmState): boolean =>
	state.modelCall !== undefined || Object.keys(state.pending).length > 0;

/**
 * 把一份 history 快照变成一次模型调用：`system` 每次都前置，但不进 history（history 只记对话）。
 * 调用方保证此刻没有在等的东西。
 */
function ask(state: LlmState, config: LlmConfig, history: History): Transition<LlmState> {
	const nextCall = state.nextCall + 1;
	const correlationId = `m${nextCall}`;
	const messages: HistoryMessage[] = [];
	if (config.system !== undefined) messages.push({ role: "system", blocks: [text(config.system)] });
	messages.push(...forModel(history));
	const input: ModelCompleteInput = {
		...(config.provider === undefined ? {} : { provider: config.provider }),
		model: config.model,
		messages,
		tools: config.tools,
		...(config.params === undefined ? {} : { params: config.params }),
	};
	return {
		state: { ...state, modelCall: correlationId, nextCall, seen: history.length },
		effects: [{ kind: modelCompleteKind.kind, input, correlationId }],
	};
}

/**
 * LLM 节点（ADR-0009）：普通节点定义，问模型、调工具；循环在图里，不在函数里。
 *
 * history 不在它身上（ADR-0010）：conversation 每次记完一条就把整份快照发过来，它只管
 * 「这份 history 要不要问模型」——上次问过之后又有 user 或 tool 消息、且自己没在等东西，就问。
 *
 * 模型思考期间进来的话不挡、也不丢：它们记在模型的回答之前，回答落进 history 之后它看见它们
 * 还没被回过，就再问一次，一次回完（要逐条回，在 conversation 前面放一个 `inbox`）。
 *
 * - 收到 `history` → 该问就问，交出一个 `model.complete`；
 * - 收到回执 → 把 assistant 消息沿 `append` 记回去；有工具调用就各发一条 `tool.<name>`、把 `callId` 记进 `pending`；没有就沿 `reply` 回话；
 * - 收到 `tool.result` → 沿 `append` 记回去、从 `pending` 删掉；记完之后 conversation 会送来新的快照。
 *
 * 每次转移只做一步，所以每一步都能落盘、被观察、被重放（ADR-0004、0007）。
 */
export const llm = defineNode<LlmState, LlmConfig>({
	name: LLM_NAME,
	version: 1,
	state: llmStateSchema,
	config: llmConfigSchema,
	ports: (config) => ({
		[HISTORY_PORT]: historySchema,
		[APPEND_PORT]: historyMessageSchema,
		reply: replyBodySchema,
		[TOOL_RESULT_PORT]: toolResultBlockSchema,
		...Object.fromEntries(config.tools.map((tool) => [`tool.${tool.name}`, toolCallBlockSchema])),
	}),
	step: ({ state, config, message }) => {
		switch (message.type) {
			case HISTORY_PORT: {
				const history = historySchema.parse(message.body);
				if (waiting(state) || !unanswered(history, state.seen)) return { state };
				return ask(state, config, history);
			}

			case TOOL_RESULT_PORT: {
				const block = message.body as ToolResultBlock;
				// 重复的结果、认不出的 callId：幂等忽略（两条结束路径都可能重复，ADR-0009）。
				if (state.pending[block.callId] === undefined) return { state };
				const pending = { ...state.pending };
				delete pending[block.callId];
				// 记进 history 是 conversation 的事；记完它会带着新的快照回来（ADR-0010）。
				return {
					state: { ...state, pending },
					sends: [{ port: APPEND_PORT, body: { role: "tool", blocks: [block] } }],
				};
			}

			case "@effect.end": {
				const body = message.body as { correlationId: string; result: ModelCompleteResult };
				// 不是我正在等的那个（或重复回执）：忽略。
				if (body.correlationId !== state.modelCall) return { state };

				const cleared: LlmState = { ...state, modelCall: undefined };
				const sends: NonNullable<Transition<LlmState>["sends"]> = [];

				if (!body.result.ok) {
					const reply = `（模型调用失败：${body.result.error}）`;
					const message: HistoryMessage = { role: "assistant", blocks: [text(reply)] };
					sends.push({ port: APPEND_PORT, body: message }, { port: "reply", body: { text: reply, message } });
					return { state: cleared, sends };
				}

				const answer = body.result.message;
				sends.push({ port: APPEND_PORT, body: answer });
				const calls = toolCallsOf(answer);

				if (calls.length === 0) {
					const reply = textOf(answer);
					if (reply !== "") sends.push({ port: "reply", body: { text: reply, message: answer } });
					return { state: cleared, sends };
				}

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
				if (failures.length > 0) sends.push({ port: APPEND_PORT, body: { role: "tool", blocks: failures } });
				// 全是没听说过的工具时 `pending` 是空的：记完失败之后 conversation 会送来快照，再问一次。
				return { state: { ...cleared, pending }, sends };
			}

			default:
				return { state };
		}
	},
});