import { nanoid } from "nanoid";
import { ContentPart } from "@/application/agent/history";
import { MessageEvent } from "@/application/event/event";

const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramChat {
	id: number | string;
}

export interface TelegramPhotoSize {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	file_size?: number;
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
	/** Smallest first; the last entry is the largest size. */
	photo?: Array<TelegramPhotoSize>;
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

	/**
	 * Bot token — only needed to download photo bytes (getFile). Without it,
	 * photo-only messages are dropped but captions still come through.
	 */
	constructor(private readonly botToken?: string) {}

	async convert(update: unknown): Promise<MessageEvent | null> {
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

		if (!msg || typeof msg !== "object" || !msg.chat) {
			return null;
		}
		if (!msg.text && !msg.photo?.length) {
			return null;
		}

		const sender = msg.from?.username ?? msg.from?.first_name;

		return {
			id: nanoid(10),
			event_type: "message",
			chat_id: String(msg.chat.id),
			adapter: "telegram",
			content: await this.buildContent(msg),
			send_time: msg.date ? msg.date * 1000 : Date.now(),
			sender,
		};
	}

	private async buildContent(
		msg: TelegramMessage,
	): Promise<string | Array<ContentPart>> {
		if (!msg.photo?.length) return msg.text ?? "";
		const image = await this.fetchLargestPhoto(
			msg.photo[msg.photo.length - 1].file_id,
		);
		if (!image) return msg.text ?? "";
		const parts: Array<ContentPart> = [];
		if (msg.text) parts.push({ type: "text", text: msg.text });
		parts.push(image);
		return parts;
	}

	private async fetchLargestPhoto(fileId: string): Promise<ContentPart | null> {
		if (!this.botToken) return null;
		try {
			const metaRes = await fetch(
				`${TELEGRAM_API}/bot${this.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
			);
			const meta = (await metaRes.json()) as {
				ok?: boolean;
				result?: { file_path?: string; mime_type?: string };
			};
			const filePath = meta.result?.file_path;
			if (!filePath) {
				console.error(`[telegram] getFile failed for ${fileId}: ${JSON.stringify(meta)}`);
				return null;
			}
			const fileRes = await fetch(
				`${TELEGRAM_API}/file/bot${this.botToken}/${filePath}`,
			);
			const bytes = Buffer.from(await fileRes.arrayBuffer());
			const mime = meta.result?.mime_type ?? "image/jpeg";
			return {
				type: "image",
				url: `data:${mime};base64,${bytes.toString("base64")}`,
			};
		} catch (e) {
			console.error(`[telegram] failed to download photo ${fileId}:`, e);
			return null;
		}
	}
}
