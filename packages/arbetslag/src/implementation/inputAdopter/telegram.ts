import { nanoid } from "nanoid";
import { MessageEvent } from "@/application/event/event";

export interface TelegramChat {
	id: number | string;
}

export interface TelegramMessage {
	message_id: number;
	chat: TelegramChat;
	from?: {
		id: number;
		username?: string;
		first_name?: string;
	};
	date?: number;
	text?: string;
}

export interface Update {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	channel_post?: TelegramMessage;
	edited_channel_post?: TelegramMessage;
}

export class TelegramInputAdopter {
	readonly tag = "telegram";

	convert(update: unknown): MessageEvent | null {
		if (
			!update ||
			typeof update !== "object" ||
			!("update_id" in update) ||
			typeof (update as Record<string, unknown>).update_id !== "number"
		) {
			return null;
		}

		const typed = update as Update;
		const msg =
			typed.message ??
			typed.edited_message ??
			typed.channel_post ??
			typed.edited_channel_post;

		if (!msg || typeof msg !== "object" || !msg.chat || !msg.text) {
			return null;
		}

		const sender = msg.from?.first_name ?? msg.from?.username ?? "user";
		const ts = new Date((msg.date ?? Math.floor(Date.now() / 1000)) * 1000);
		const time = `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;

		return {
			id: nanoid(10),
			event_type: "message",
			chat_id: String(msg.chat.id),
			adapter: "telegram",
			// 与 system prompt 中 example 的输入格式一致：
			// 【最近聊天记录】\n[HH:MM] 发送者: 内容
			content: `【最近聊天记录】\n[${time}] ${sender}: ${msg.text}`,
		};
	}
}
