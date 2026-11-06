import { defineNode } from "@arbetslag/kernel";
import { z } from "zod";
import { TELEGRAM_OUTPUT, type TelegramMessage } from "../listeners/telegram.ts";
import { telegramSendKind } from "../performers/telegramSend.ts";

/**
 * Telegram 中继：一个 chat 一个。把聊天消息换成 `user`（`conversation` 认的那种），
 * 把 LLM 节点的 `reply` 经 `telegram.send` 发回同一个 bot 的同一个 chat。
 * 回复是空白就不发：那是模型选择不说话。
 */
export const telegramRelay = defineNode({
	name: "telegramRelay",
	version: 1,
	state: z.null().default(null),
	config: z.object({ listener: z.string().min(1), chatId: z.number().int() }),
	ports: () => ({ user: z.object({ text: z.string() }) }),
	step: ({ state, config, message }) => {
		switch (message.type) {
			case TELEGRAM_OUTPUT:
				return { state, sends: [{ port: "user", body: { text: (message.body as TelegramMessage).text } }] };
			case "reply": {
				const text = (message.body as { text: string }).text.trim();
				if (text === "") return { state };
				return {
					state,
					effects: [{ kind: telegramSendKind.kind, input: { listener: config.listener, chatId: config.chatId, text } }],
				};
			}
			default:
				return { state }; // `@effect.end`：发出去就完了
		}
	},
});
