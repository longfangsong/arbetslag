import type { JsonValue } from "type-fest";
import type { EffectKindDefinition } from "@arbetslag/kernel";
import { z } from "zod";
import type { Performer } from "../executor.ts";
import { type TelegramOptions, type TelegramTransport, createTelegramTransport } from "../listeners/telegram.ts";

/**
 * `telegram.send`：往一个 chat 发一句话。`listener` 指明用哪个 bot（ADR-0018）——
 * 快照里只有这个名字，token 在部署里。不可重放：发出去的话收不回来（ADR-0016）。
 */
export const telegramSendKind: EffectKindDefinition = {
	kind: "telegram.send",
	input: z.object({ listener: z.string().min(1), chatId: z.number().int(), text: z.string().min(1) }),
	result: z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string() })]),
};

/** 与监听器共用同一份 `bots`：回话用的就是收到消息的那个 bot。 */
export function createTelegramSender(options: TelegramOptions): Performer {
	const transports = new Map<string, TelegramTransport>();
	const transportOf = (listener: string): TelegramTransport | undefined => {
		if (options.transport !== undefined) return options.transport;
		const bot = options.bots[listener];
		if (bot === undefined) return undefined;
		let transport = transports.get(listener);
		if (transport === undefined) {
			transport = createTelegramTransport(bot);
			transports.set(listener, transport);
		}
		return transport;
	};

	return async (input, { signal }): Promise<JsonValue> => {
		const { listener, chatId, text } = input as { listener: string; chatId: number; text: string };
		const transport = transportOf(listener);
		if (transport === undefined) return { ok: false, error: `no bot ${JSON.stringify(listener)} in this deployment` };
		// 抛错（Telegram 回 `ok: false`、网络断了）由宿主变成 `{ ok: false, error }`。
		await transport("sendMessage", { chat_id: chatId, text }, signal);
		return { ok: true };
	};
}
