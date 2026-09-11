import { PINS } from "./prompt/pin";

export class SmartTelegramRouter {
	private readonly botToken: string;
	private readonly chatId: string;
    private readonly TEST_MODE = process.env.TEST_MODE === "true" || process.env.TEST_MODE === "1";

	constructor(botToken: string, chatId: string) {
		this.botToken = botToken;
		this.chatId = chatId;
	}

	async route({ content }: { content?: string }): Promise<void> {
		content = content?.trim();
		if (!content || content === '""' || content === "''") {
			console.log(`[SmartTelegramRouter] No content to send`);
			return;
		}

		const stickerTokens = [
			...content.matchAll(/\[\[sticker:([a-zA-Z0-9_-]+)\]\]/g),
		].map((m) => m[1]);
		const pin = PINS.find((p) =>
			content.includes(`[[pin:${p.id}]]`),
		);
		let text = content
			.replace(/\[\[sticker:[a-zA-Z0-9_-]+\]\]/g, "")
			.replace(/\[\[pin:[a-zA-Z0-9_-]+\]\]/g, "！")
			.trim();
		if (pin) {
			console.log(
				`[SmartTelegramRouter] quoting pinned message ${pin.id} (#${pin.messageId})`,
			);
		}

		if (stickerTokens.length === 0 && !text) {
			console.log(`[SmartTelegramRouter] No content to send`);
			return;
		}

		console.log(
			`[SmartTelegramRouter] Sending to chat ${this.chatId}: ${text || "(sticker only)"}${stickerTokens.length ? ` + sticker(s): ${stickerTokens.join(", ")}` : ""}`,
		);

		if (this.TEST_MODE) {
			return;
		}

		if (text) {
			const webhookUrl = `https://api.telegram.org/bot${this.botToken}/sendRichMessage`;
			const res = await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: this.chatId,
					rich_message: { markdown: text },
					...(pin ? { reply_to_message_id: pin.messageId } : {}),
				}),
			});
			if (!res.ok) {
				const body = await res.text();
				console.log(`[SmartTelegramRouter] error: ${res.status} ${body}`);
				throw new Error(`Telegram API error: ${res.status} ${body}`);
			}
		}

		for (const id of stickerTokens) {
			const sticker = STICKERS.find((s) => s.id === id);
			if (!sticker) {
				console.warn(`[SmartTelegramRouter] unknown sticker id: ${id}`);
				continue;
			}
			const res = await fetch(
				`https://api.telegram.org/bot${this.botToken}/sendSticker`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ chat_id: this.chatId, sticker: sticker.fileId }),
				},
			);
			if (!res.ok) {
				const body = await res.text();
				console.log(`[SmartTelegramRouter] sendSticker error: ${res.status} ${body}`);
			}
		}
	}
}