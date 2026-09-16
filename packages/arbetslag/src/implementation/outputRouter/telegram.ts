import { OutputRouter, type SystemNotice } from "@/application/outputRouter/model";
import { AgentOutput } from "@/application/event/event";
import { Result, ok, err } from "neverthrow";
import createDebug from "debug";

const log = createDebug("arbetslag:output");

export class Telegram implements OutputRouter {
	private readonly botToken: string;
	readonly chatId: string;
	private readonly apiBase: string;

	constructor(botToken: string, chatId: string, apiBase = "https://api.telegram.org") {
		this.botToken = botToken;
		this.chatId = chatId;
		this.apiBase = apiBase;
	}

	async route(event: AgentOutput | SystemNotice): Promise<Result<void, string>> {
		log(`chatId=${this.chatId}, content_len=${(event.content ?? '').length}`);
		log(`content_preview="${(event.content ?? '').slice(0, 200)}"`);
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
			log(`❌ error: ${res.status} ${body}`);
			return err(`Telegram API error: ${res.status} ${body}`);
		}
		log(`✅ sent OK`);
		return ok(undefined);
	}
}
