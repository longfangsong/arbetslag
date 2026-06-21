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
	};
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

		return {
			id: nanoid(10),
			event_type: "message",
			chat_id: String(msg.chat.id),
			adapter: "telegram",
			content: msg.text,
		};
	}
}
