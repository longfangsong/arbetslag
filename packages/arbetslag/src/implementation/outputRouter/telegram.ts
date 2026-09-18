import { OutputRouter, type Compacted } from "@/application/outputRouter/model";
import { AgentOutput } from "@/application/event/event";
import { Result, ok, err } from "neverthrow";

export class Telegram implements OutputRouter {
	private readonly botToken: string;
	readonly chatId: string;
	private readonly apiBase: string;

	constructor(botToken: string, chatId: string, apiBase = "https://api.telegram.org") {
		this.botToken = botToken;
		this.chatId = chatId;
		this.apiBase = apiBase;
	}

	async route(event: AgentOutput | Compacted): Promise<Result<void, string>> {
		// Compacted carries no copy: render the user-facing wording from
		// the structured fields (this default adapter uses English).
		const markdown =
			"kind" in event
				? event.beforeTokens != null && event.afterTokens != null
					? `📦 Compacted history: ${formatTokens(event.beforeTokens)} → ${formatTokens(event.afterTokens)} tokens`
					: "📦 Nothing to compact"
				: event.content;
		console.log(`[TelegramOutput] chatId=${this.chatId}, content_len=${(markdown ?? '').length}`);
		console.log(`[TelegramOutput] content_preview="${(markdown ?? '').slice(0, 200)}"`);
		const res = await fetch(
			`${this.apiBase}/bot${this.botToken}/sendRichMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: this.chatId,
					rich_message: {
						markdown: markdown,
					},
				}),
			},
		);
		if (!res.ok) {
			const body = await res.text();
			console.log(`[TelegramOutput] ❌ error: ${res.status} ${body}`);
			return err(`Telegram API error: ${res.status} ${body}`);
		}
		console.log(`[TelegramOutput] ✅ sent OK`);
		return ok(undefined);
	}
}

function formatTokens(n: number): string {
	return n >= 1000 ? `~${(n / 1000).toFixed(1)}K` : `~${n}`;
}
