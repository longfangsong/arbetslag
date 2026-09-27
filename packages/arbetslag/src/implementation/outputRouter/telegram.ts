import type {
	OutputEvent,
	OutputRouter,
	SerializedOutputRouter,
} from "@/application/outputRouter/model";
import { Result, ok, err } from "neverthrow";
import createDebug from "debug";

const log = createDebug("arbetslag:output");

export class Telegram implements OutputRouter {
	readonly kind = "telegram";
	private readonly botToken: string;
	readonly chatId: string;
	private readonly apiBase: string;

	constructor(botToken: string, chatId: string, apiBase = "https://api.telegram.org") {
		this.botToken = botToken;
		this.chatId = chatId;
		this.apiBase = apiBase;
	}

	/** The bot token is app config, not agent state: the Registry factory supplies it. */
	serialize(): SerializedOutputRouter {
		return { kind: this.kind, config: { chatId: this.chatId, apiBase: this.apiBase } };
	}

	async route(event: OutputEvent): Promise<Result<void, string>> {
		// Compacted carries no copy: render the user-facing wording from
		// the structured fields (this default adapter uses English).
		const markdown =
			"kind" in event
				? event.beforeTokens != null && event.afterTokens != null
					? `📦 Compacted history: ${formatTokens(event.beforeTokens)} → ${formatTokens(event.afterTokens)} tokens`
					: "📦 Nothing to compact"
				: event.content;
		log(`chatId=${this.chatId}, content_len=${(markdown ?? '').length}`);
		log(`content_preview="${(markdown ?? '').slice(0, 200)}"`);
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
			log(`❌ error: ${res.status} ${body}`);
			return err(`Telegram API error: ${res.status} ${body}`);
		}
		log(`✅ sent OK`);
		return ok(undefined);
	}
}

function formatTokens(n: number): string {
	return n >= 1000 ? `~${(n / 1000).toFixed(1)}K` : `~${n}`;
}
