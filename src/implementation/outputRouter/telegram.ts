import { OutputRouter } from "@/application/outputRouter/model";
import { AgentOutput } from "@/application/event/event";

export class Telegram implements OutputRouter {
	private readonly botToken: string;
	readonly chatId: string;
	private readonly apiBase: string;

	constructor(botToken: string, chatId: string, apiBase = "https://api.telegram.org") {
		this.botToken = botToken;
		this.chatId = chatId;
		this.apiBase = apiBase;
	}

	async route(event: AgentOutput): Promise<void> {
		console.log(`[TelegramOutput] chatId=${this.chatId}, content_len=${(event.content ?? '').length}`);
		console.log(`[TelegramOutput] content_preview="${(event.content ?? '').slice(0, 200)}"`);
		const res = await fetch(
			`${this.apiBase}/bot${this.botToken}/sendRichMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: this.chatId,
					rich_message: {
						markdown: event.content,
					},
				}),
			},
		);
		if (!res.ok) {
			const body = await res.text();
			console.log(`[TelegramOutput] ❌ error: ${res.status} ${body}`);
			throw new Error(`Telegram API error: ${res.status} ${body}`);
		}
		console.log(`[TelegramOutput] ✅ sent OK`);
	}
}
