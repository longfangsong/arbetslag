/**
 * 这份图本身：节点、边、触发器声明、效果种类。宿主怎么接（真的 Telegram、真的模型、
 * 还是自测用的假的）不在这里——`main.ts` 接真的，`selftest.ts` 接假的。
 */
import { z } from "zod";
import { type WorkflowTemplate, createRegistry, defineNode } from "@arbetslag/kernel";
import {
	APPEND_PORT,
	CONVERSATION_NAME,
	HISTORY_PORT,
	agent,
	agentLayout,
	conversation,
	defineTool,
	modelCompleteKind,
	timerWaitKind,
} from "@arbetslag/agents";
import { telegramKind } from "@arbetslag/host-node";

/** 把一句话发回 Telegram：chat id 由 relay 从聊天消息里记住。 */
export const telegramSendKind = {
	kind: "telegram.send",
	input: z.object({ chatId: z.number().int(), text: z.string() }),
	result: z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string() })]),
};

/** 一个真工具：模型要时间就调它。 */
export const clock = defineTool({
	name: "clock",
	description: "看当前时间（UTC，形如 08:15:00）",
	input: z.object({}),
	state: z.null().default(null),
	config: z.null(),
	run: () => ({ state: null, result: { time: new Date().toISOString().slice(11, 19) } }),
});

/**
 * 会话中继：记着这条会话的 chat id（私有状态），把用户的话转给 agent、把 agent 的话发回 chat。
 * 一份工作流服务所有 chat，所以这里是「最后一个说话的人」——单人 demo 够用。
 */
export const relay = defineNode({
	name: "relay",
	version: 1,
	state: z.object({ chatId: z.number().int().optional(), seen: z.number() }).default({ seen: 0 }),
	config: z.null(),
	ports: () => ({ user: z.object({ text: z.string() }) }),
	step: ({ state, message }) => {
		switch (message.type) {
			case "message": {
				// 触发器投进来的就是聊天消息（`telegram` 种类的输出）。
				const body = message.body as { text: string; chatId: number; from?: string };
				return {
					state: { ...state, chatId: body.chatId, seen: state.seen + 1 },
					sends: [{ port: "user", body: { text: body.text } }],
				};
			}
			case "reply": {
				const { text } = message.body as { text: string };
				if (state.chatId === undefined) return { state }; // 还没人说过话：没处回
				return {
					state,
					effects: [{ kind: telegramSendKind.kind, input: { chatId: state.chatId, text } }],
				};
			}
			default:
				return { state }; // `@effect.end`：发出去就完了
		}
	},
});

export function buildGraph(options: { model: string; system: string }) {
	const layout = agentLayout({
		agent: "bot",
		config: { model: options.model, system: options.system },
		tools: [{ tool: clock }],
	});

	const template: WorkflowTemplate = {
		nodes: {
			...layout.nodes,
			// 对话历史在 `chat` 里（ADR-0010）；relay 只管把话换成 Telegram 消息。
			chat: { definition: CONVERSATION_NAME, config: null },
			relay: { definition: "relay", config: null },
		},
		edges: [
			...layout.edges,
			{ from: "chat", to: "bot", port: HISTORY_PORT },
			{ from: "bot", to: "chat", port: APPEND_PORT },
			{ from: "bot", to: "relay", port: "reply" },
			{ from: "relay", to: "chat", port: "user" },
			// 触发器的一条输出就是一条边：聊天消息从 `message` 这个端口进 relay。
			{ from: "tg", to: "relay", port: "message" },
		],
		triggers: [{ id: "tg", kind: "telegram", config: { output: "message" } }],
	};

	const registry = createRegistry({
		nodes: [agent, conversation, clock, relay],
		effects: [modelCompleteKind, timerWaitKind, telegramSendKind],
		triggers: [telegramKind],
	});

	return { template, registry };
}
