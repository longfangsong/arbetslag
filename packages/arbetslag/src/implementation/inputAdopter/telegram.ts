import { nanoid } from "nanoid";
import { Content, ContentPart, text } from "@/application/agent/history";
import { MessageEvent } from "@/application/event/event";
import createDebug from "debug";

const TELEGRAM_API = "https://api.telegram.org";
const log = createDebug("arbetslag:input");

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
	/** Present when the message is a sticker. */
	sticker?: { emoji?: string };
	/** Smallest first; the last entry is the largest size. */
	photo?: Array<TelegramPhotoSize>;
	/** Present when the message quotes another message in the same chat. */
	reply_to_message?: TelegramMessage;
}

export interface Update {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	channel_post?: TelegramMessage;
	edited_channel_post?: TelegramMessage;
}

/** A self-contained <reply_to> block, optionally with the quoted photo re-inlined. */
interface ReplyBlock {
	text: string;
	image: ContentPart | null;
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

		const body = await this.buildContent(msg);
		return {
			id: nanoid(10),
			event_type: "message",
			chat_id: String(msg.chat.id),
			adapter: "telegram",
			content: this.assemble(
				sender,
				await this.buildReply(msg.reply_to_message),
				body,
			),
			send_time: msg.date ? msg.date * 1000 : Date.now(),
			sender,
		};
	}

	/** Max characters of a quoted original kept in the reply block. */
	private static readonly REPLY_MAX_CHARS = 200;

	/**
	 * Build the <reply_to> block for a quoted message. Text is inlined
	 * (truncated when long), a sticker is rendered as its emoji, and a
	 * photo is re-downloaded and inlined as an image part so the LLM can
	 * tell photos apart. Returns null when the quoted message is
	 * unavailable.
	 */
	private async buildReply(
		replyTo: TelegramMessage | undefined,
	): Promise<ReplyBlock | null> {
		if (!replyTo) return null;
		const sender = replyTo.from?.username ?? replyTo.from?.first_name;
		const attr = sender ? ` sender="${sender}"` : "";
		const original = this.describeReplyTarget(replyTo);
		if (original === undefined) return null;
		if (original === null) {
			// Quoted photo: re-inline the largest size; the [photo] marker
			// stays in the block so the image part reads as the quoted content.
			const largest = replyTo.photo![replyTo.photo!.length - 1];
			const image = await this.fetchLargestPhoto(largest.file_id);
			return { text: `<reply_to${attr}>\n[photo]\n</reply_to>`, image };
		}
		return { text: `<reply_to${attr}>\n${original}\n</reply_to>`, image: null };
	}

	/**
	 * Textual rendering of the quoted message's content: its text
	 * (truncated when long) or a sticker marker with its emoji.
	 * Returns null for photo targets (handled by re-inlining), and
	 * undefined when the content cannot be rendered at all.
	 */
	private describeReplyTarget(
		replyTo: TelegramMessage,
	): string | null | undefined {
		if (replyTo.text) {
			return replyTo.text.length > TelegramInputAdopter.REPLY_MAX_CHARS
				? `${replyTo.text.slice(0, TelegramInputAdopter.REPLY_MAX_CHARS)}（原文较长，已截断）`
				: replyTo.text;
		}
		if (replyTo.sticker) {
			const emoji = replyTo.sticker.emoji ? ` ${replyTo.sticker.emoji}` : "";
			return `[sticker${emoji}]`;
		}
		if (replyTo.photo?.length) return null;
		return undefined;
	}

	/**
	 * Assemble the leading `[sender]: ` signature and the optional
	 * <reply_to> block in front of the message body. Without a re-inlined
	 * image the lead merges into the first text part; with one, the lead
	 * stands alone so the quoted image part stays adjacent to the block.
	 */
	private assemble(
		sender: string | undefined,
		reply: ReplyBlock | null,
		body: Content,
	): Content {
		const sig = sender ? `[${sender}]: ` : "";
		if (!reply) {
			if (!sig) return body;
			return this.prependLead(sig, body);
		}
		const lead = `${sig}${reply.text}\n`;
		if (!reply.image) return this.prependLead(lead, body);
		const parts: Array<ContentPart> = [
			{ type: "text", text: lead },
			reply.image,
		];
		return [...parts, ...body];
	}

	private prependLead(lead: string, body: Content): Content {
		const [first, ...rest] = body;
		if (first?.type === "text") {
			return [{ type: "text", text: lead + first.text }, ...rest];
		}
		return [{ type: "text", text: lead }, ...body];
	}

	private async buildContent(msg: TelegramMessage): Promise<Content> {
		if (!msg.photo?.length) return text(msg.text ?? "");
		const image = await this.fetchLargestPhoto(
			msg.photo[msg.photo.length - 1].file_id,
		);
		if (!image) return text(msg.text ?? "");
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
				log(`❌ getFile failed for ${fileId}: ${JSON.stringify(meta)}`);
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
			log(`❌ failed to download photo ${fileId}:`, e);
			return null;
		}
	}
}
