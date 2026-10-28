import type { JsonValue } from "type-fest";
import { defineNode, type Transition } from "@arbetslag/kernel";
import { z } from "zod";
import {
	APPEND_PORT,
	HISTORY_PORT,
	type History,
	type HistoryMessage,
	type ToolResultBlock,
	answerable,
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

/**
 * agent 的私有状态（ADR-0009）：只剩「在等什么」，**不含 history**（history 在 conversation 里，ADR-0010）。
 */
export const agentStateSchema = z
	.object({
		/** 正在等的模型调用（`correlationId`）；有值就不发新的。 */
		modelCall: z.string().optional(),
		/** 正在等的工具调用：`callId` → 工具名。集合空了才等下一份 history 快照。 */
		pending: z.record(z.string(), z.string()).default({}),
		/** 生成 `correlationId` 的单调计数。 */
		nextCall: z.number().int().nonnegative().default(0),
	})
	.default({ pending: {}, nextCall: 0 });

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

/** 发给 agent 的输入：用户说的话（触发器与入口节点用它，ADR-0005）。 */
/** agent 的回复：文本 + 那条 assistant 消息（下游想用整条就用整条）。 */
const replyBodySchema = z.object({ text: z.string(), message: historyMessageSchema });

const waiting = (state: AgentState): boolean =>
	state.modelCall !== undefined || Object.keys(state.pending).length > 0;

/**
 * 把一份 history 快照变成一次模型调用：`system` 每次都前置，但不进 history（history 只记对话）。
 * 调用方保证此刻没有在等的东西。
 */
function ask(state: AgentState, config: AgentConfig, history: History): Transition<AgentState> {
	const nextCall = state.nextCall + 1;
	const correlationId = `m${nextCall}`;
	const messages: HistoryMessage[] = [];
	if (config.system !== undefined) messages.push({ role: "system", blocks: [text(config.system)] });
	messages.push(...history);
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
 * history 不在它身上（ADR-0010）：conversation 每次记完一条就把整份快照发过来，agent 只管
 * 「这份 history 要不要问模型」——最后一条是 user 或 tool、且自己没在等东西，就问。
 *
 * - 收到 `history` → 该问就问，交出一个 `model.complete`；
 * - 收到回执 → 把 assistant 消息沿 `append` 记回去；有工具调用就各发一条 `tool.<name>`、把 `callId` 记进 `pending`；没有就沿 `reply` 回话；
 * - 收到 `tool.result` → 沿 `append` 记回去、从 `pending` 删掉；记完之后 conversation 会送来新的快照。
 *
 * 每次转移只做一步，所以每一步都能落盘、被观察、被重放（ADR-0004、0007）。
 */
export const agent = defineNode<AgentState, AgentConfig>({
	name: AGENT_NAME,
	version: 2,
	state: agentStateSchema,
	config: agentConfigSchema,
	// v1 的 history 长在 agent 身上；搬走之后没有诚实的自动迁移可做（ADR-0010），所以停住让人处理。
	migrate: (state) => {
		const { history, ...rest } = state as { history?: JsonValue } & Record<string, JsonValue>;
		if (history !== undefined) {
			throw new Error("agent v1 kept history in its state; it lives in a conversation node now (ADR-0010)");
		}
		return rest as AgentState;
	},
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
				if (waiting(state) || !answerable(history)) return { state };
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

				const cleared: AgentState = { ...state, modelCall: undefined };
				const sends: NonNullable<Transition<AgentState>["sends"]> = [];

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