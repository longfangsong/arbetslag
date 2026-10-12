import { PINS } from "./prompt/pin";
import { STICKERS } from "./prompt/sticker";
import type { AgentOutput, AgentRepository, Compacted } from "arbetslag";
import { Result, ok, err } from "neverthrow";
import { log, warn } from "./logger";

/**
 * Output router for the whole bot, not one chat: the target chat is resolved
 * per event from the producing agent, so outputs of concurrent chats are all
 * served by this single instance.
 */
export class SmartTelegramRouter {
	private readonly botToken: string;
	private readonly agentRepository: AgentRepository;
    private readonly TEST_MODE = process.env.TEST_MODE === "true" || process.env.TEST_MODE === "1";

	constructor(botToken: string, agentRepository: AgentRepository) {
		this.botToken = botToken;
		this.agentRepository = agentRepository;
	}

	async route(event: AgentOutput | Compacted): Promise<Result<void, string>> {
		// Compacted notices are log-only, never sent to the chat.
		if ("kind" in event) {
			const detail =
				typeof event.beforeTokens === "number"
					? ` ${event.beforeTokens} -> ${event.afterTokens} tokens`
					: " (nothing to compact)";
			log(`    [SmartTelegramRouter] ${event.kind}${detail}`);
			return ok(undefined);
		}
		const chatId = await this.agentRepository.getChatIdByAgentId(
			event.from_agent_id,
		);
		if (!chatId) {
			warn(
				`    [SmartTelegramRouter] no chat for agent ${event.from_agent_id}; dropping output`,
			);
			return ok(undefined);
		}
		let content: string | undefined = event.content;
    content = content?.trim();
		content = content?.replace(/^"(.*)"$/, "$1");
		if (!content || content === '""' || content === "''") {
			return ok(undefined);
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

		if (stickerTokens.length === 0 && !text) {
			return ok(undefined);
		}

		if (this.TEST_MODE) {
			return ok(undefined);
		}

		if (text) {
			const webhookUrl = `https://api.telegram.org/bot${this.botToken}/sendRichMessage`;
			const res = await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: chatId,
					rich_message: { markdown: text },
					...(pin ? { reply_to_message_id: pin.messageId } : {}),
				}),
			});
			if (!res.ok) {
				const body = await res.text();
				log(`    [SmartTelegramRouter] error: ${res.status} ${body}`);
				return err(`Telegram API error: ${res.status} ${body}`);
			}
		}

		for (const id of stickerTokens) {
			const sticker = STICKERS.find((s) => s.id === id);
			if (!sticker) {
				warn(`    [SmartTelegramRouter] unknown sticker id: ${id}`);
				continue;
			}
			const res = await fetch(
				`https://api.telegram.org/bot${this.botToken}/sendSticker`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: chatId,
						sticker: sticker.fileId,
					}),
				},
			);
			if (!res.ok) {
				const body = await res.text();
				log(`    [SmartTelegramRouter] sendSticker error: ${res.status} ${body}`);
			}
		}
		return ok(undefined);
	}
}
