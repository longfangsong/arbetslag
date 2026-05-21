import { MessageEvent } from "@/domain/event/model";
import { InputAdopter } from "@/domain/inputAdopter/model";
import { nanoid } from "nanoid";

// Minimal Telegram Bot API types — only fields we use.
// Full spec: https://core.telegram.org/bots/api#update
export interface TelegramChat {
	id: number | string;
	type?: string;
	title?: string;
	username?: string;
	first_name?: string;
	last_name?: string;
	is_bot?: boolean;
}

export interface TelegramMessage {
	message_id: number;
	date: number;
	chat: TelegramChat;
	from?: {
		id: number;
		is_bot?: boolean;
		first_name?: string;
		username?: string;
	};
	text?: string;
	// Other fields omitted — we only need chat.id and text.
}

export interface Update {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	channel_post?: TelegramMessage;
	edited_channel_post?: TelegramMessage;
}

/**
 * TelegramInputAdopter converts Telegram Bot API updates into framework Events.
 */
export class TelegramInputAdopter implements InputAdopter {
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

		// Extract the message-like object from whichever payload is present
		const msg =
			typed.message ??
			typed.edited_message ??
			typed.channel_post ??
			typed.edited_channel_post;

		if (
			!msg ||
			typeof msg !== "object" ||
			!msg.chat ||
			typeof msg.chat !== "object" ||
			!msg.text
		) {
			return null;
		}

		return {
			id: nanoid(10),
			chat_id: String(msg.chat.id),
			adapter: "telegram",
			event_type: "message",
			payload: { content: msg.text },
		};
	}
}
