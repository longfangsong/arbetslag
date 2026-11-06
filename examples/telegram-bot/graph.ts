/**
 * 这份图本身：总机、每个 chat 一份的会话工作流、注册表。宿主怎么接（真的 Telegram、真的模型、
 * 还是自测用的假的）不在这里——`main.ts` 接真的，`selftest.ts` 接假的。
 *
 * 一个 bot token 只有一个监听器（`tg`，部署配置）；工作流各自订阅它（ADR-0015）：
 * - 会话工作流 `chat:<id>`：订阅 `chatIs(<id>)`，优先级 0；
 * - 总机 `switchboard`：订阅全部，优先级 -1，只接没人认领的消息——也就是每个 chat 的第一句。
 */
import { z } from "zod";
import { type WorkflowTemplate, createRegistry, defineNode } from "@arbetslag/kernel";
import {
	APPEND_PORT,
	CONVERSATION_NAME,
	HISTORY_PORT,
	llm,
	wireTools,
	conversation,
	defineTool,
	modelCompleteKind,
} from "@arbetslag/llm";
import { TELEGRAM_OUTPUT, type TelegramMessage, chatIs, telegramKind } from "@arbetslag/host-node";

/** 部署里那个监听器的 id：一个 bot token 一个。 */
export const LISTENER = "tg";
export const SWITCHBOARD = "switchboard";
export const chatWorkflowId = (chatId: number) => `chat:${chatId}`;

/** 把一句话发回 Telegram。 */
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

/** 会话中继：一个 chat 一份，chat id 在 config 里。把聊天消息换成 `user`，把 LLM 节点的回复发回这个 chat。 */
export const relay = defineNode({
	name: "relay",
	version: 2,
	state: z.null().default(null),
	config: z.object({ chatId: z.number().int() }),
	ports: () => ({ user: z.object({ text: z.string() }) }),
	step: ({ state, config, message }) => {
		switch (message.type) {
			case TELEGRAM_OUTPUT:
				return { state, sends: [{ port: "user", body: { text: (message.body as TelegramMessage).text } }] };
			case "reply": {
				const { text } = message.body as { text: string };
				return { state, effects: [{ kind: telegramSendKind.kind, input: { chatId: config.chatId, text } }] };
			}
			default:
				return { state }; // `@effect.end`：发出去就完了
		}
	},
});

export function buildGraph(options: { model: string; system: string }) {
	const layout = wireTools({
		llm: "bot",
		config: { model: options.model, system: options.system },
		tools: [{ node: clock }],
	});

	/** 一个 chat 的会话工作流：只订阅这个 chat（匹配函数），默认分组、优先级 0。`chatId` 由总机填（ADR-0018）。 */
	const chatTemplate: WorkflowTemplate = {
		params: { chatId: 0 },
		nodes: {
			...layout.nodes,
			// 对话历史在 `chat` 里（ADR-0010）；relay 只管把话换成 Telegram 消息。
			chat: { definition: CONVERSATION_NAME, config: null },
			relay: { definition: "relay", config: { chatId: "{{chatId}}" } },
		},
		edges: [
			...layout.edges,
			{ from: "chat", to: "bot", port: HISTORY_PORT },
			{ from: "bot", to: "chat", port: APPEND_PORT },
			{ from: "bot", to: "relay", port: "reply" },
			{ from: "relay", to: "chat", port: "user" },
			{ from: "tg", to: "relay", port: TELEGRAM_OUTPUT },
		],
		triggers: [
			{ id: "tg", kind: "telegram", listener: LISTENER, match: { fn: "chatIs", config: { chatId: "{{chatId}}" } } },
		],
	};

	/** 总机：为没人认领的 chat 起一份会话工作流，并把这句话转交过去（`workflow.spawn`）。 */
	const switchboard = defineNode({
		name: "switchboard",
		version: 1,
		state: z.object({ spawned: z.number() }).default({ spawned: 0 }),
		config: z.null(),
		ports: () => ({}),
		step: ({ state, message }) => {
			if (message.type !== TELEGRAM_OUTPUT) return { state }; // 回执：`created` 真假都不用管
			const body = message.body as TelegramMessage;
			return {
				state: { spawned: state.spawned + 1 },
				effects: [
					{
						kind: "workflow.spawn",
						input: {
							id: chatWorkflowId(body.chatId),
							template: "chat",
							params: { chatId: body.chatId },
							forward: { trigger: "tg", output: TELEGRAM_OUTPUT, body, eventId: String(body.updateId) },
						},
					},
				],
			};
		},
	});

	const switchboardTemplate: WorkflowTemplate = {
		nodes: { switchboard: { definition: "switchboard", config: null } },
		edges: [{ from: "tg", to: "switchboard", port: TELEGRAM_OUTPUT }],
		triggers: [{ id: "tg", kind: "telegram", listener: LISTENER, priority: -1 }],
	};

	const registry = createRegistry({
		nodes: [llm, conversation, clock, relay, switchboard],
		effects: [modelCompleteKind, telegramSendKind],
		triggers: [telegramKind],
		matchers: [chatIs],
	});

	return { switchboardTemplate, templates: { chat: chatTemplate }, registry };
}
