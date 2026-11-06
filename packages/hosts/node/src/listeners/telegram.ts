import type { JsonValue } from "type-fest";
import { z } from "zod";
import type { TriggerKindDefinition } from "@arbetslag/kernel";
import {
	type ListenerHandle,
	type ListenerHooks,
	type ListenerRuntime,
	ListenerUnready,
} from "./runtime.ts";

/**
 * telegram 这种触发器：订阅一侧没有 config，只有一个输出 `message`（一条带文字的聊天消息）。
 * 想只收某个 chat 就用匹配函数（`chatIs`，ADR-0015），不写在 config 里。
 */
export type TelegramTriggerConfig = Record<string, never>;

/**
 * 投给节点的那条消息的载荷：文字 + 它从哪个聊天来。`updateId` 让总机能把它原样转交（`eventId`）。
 * `listener` 是收到它的那个监听器（哪个 bot）：一个部署可以有好几个 bot（ADR-0018），回话要用同一个。
 */
export type TelegramMessage = {
	listener: string;
	text: string;
	chatId: number;
	messageId: number;
	updateId: number;
	/** 发件人的展示名，方便日志。 */
	from?: string;
};

export const telegramMessageSchema = z.object({
	listener: z.string().min(1),
	text: z.string().min(1),
	chatId: z.number().int(),
	messageId: z.number().int(),
	updateId: z.number().int(),
	from: z.string().optional(),
});

export const TELEGRAM_OUTPUT = "message";

export const telegramKind: TriggerKindDefinition<TelegramTriggerConfig> = {
	kind: "telegram",
	config: z.object({}).strict() as unknown as z.ZodType<TelegramTriggerConfig>,
	outputs: () => ({ [TELEGRAM_OUTPUT]: telegramMessageSchema }),
};

/** 监听器一侧的 config：一个 bot 一条长轮询。token 不进这里（部署的密钥），从 runtime 的 `bots` 给。 */
export const telegramListenerConfig = z.object({
	/** 长轮询等多久（Telegram 上限 50 秒）。默认 25。 */
	pollSeconds: z.number().int().min(1).max(50).default(25),
	/** 只收这些 chat（留空表示都收）。 */
	allowChats: z.array(z.number().int()).default([]),
});

export type TelegramListenerConfig = z.infer<typeof telegramListenerConfig>;

/** `getUpdates` 里我们认的那部分；别的（edited_message、callback_query）这一版不处理。 */
const updateSchema = z.object({
	update_id: z.number().int(),
	message: z
		.object({
			message_id: z.number().int(),
			chat: z.object({ id: z.number().int() }),
			from: z
				.object({ username: z.string().optional(), first_name: z.string().optional() })
				.optional(),
			text: z.string().optional(),
		})
		.optional(),
});

type TelegramUpdate = z.infer<typeof updateSchema>;

/**
 * 调 Telegram 的那一下。默认走 `fetch`；测试注入一个假的，就不用联网。
 * 返回 `result` 字段；`ok: false` 抛错。
 */
export type TelegramTransport = (method: string, body: unknown, signal: AbortSignal) => Promise<JsonValue>;

/** 一个 bot 的密钥与网关。 */
export type TelegramBot = {
	token: string;
	/** 默认 `https://api.telegram.org`；自建网关、测试用的假 Telegram 改这里。 */
	apiBase?: string;
};

/**
 * 部署里的 bot，按监听器 id（ADR-0018）：一个 token 一个监听器（ADR-0015）。
 * 监听器与 `telegram.send` 共用这一份，回话因此能用收到消息的那个 bot。
 */
export type TelegramBots = Readonly<Record<string, TelegramBot | undefined>>;

export type TelegramOptions = {
	bots: TelegramBots;
	/** 测试注入：不联网。给了就忽略各 bot 的 token 与 `apiBase`。 */
	transport?: TelegramTransport;
};

export const DEFAULT_TELEGRAM_API = "https://api.telegram.org";

export type TelegramHandle = ListenerHandle & { bot: string };

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createTelegramTransport(bot: TelegramBot): TelegramTransport {
	const apiBase = bot.apiBase ?? DEFAULT_TELEGRAM_API;
	const { token } = bot;
	return async (method, body, signal) => {
		const response = await fetch(`${apiBase}/bot${token}/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal,
		});
		const payload = (await response.json()) as { ok?: boolean; result?: JsonValue; description?: string };
		if (payload.ok !== true) {
			throw new Error(`telegram ${method} failed: ${payload.description ?? response.status}`);
		}
		return payload.result ?? null;
	};
}

/**
 * 一个监听器一条长轮询：`getUpdates` → 交给路由 → `offset` 前进。
 *
 * `open` 先用 `getMe` 探一下：token 不对、或者这个 bot 上还挂着 webhook（409），
 * 都抛 `ListenerUnready`（→ 未就绪，宿主重试），不涉及任何工作流。
 * 轮询中途出错（网络断了）走 `hooks.unready`，然后这条监听自己停下——重开交给宿主。
 *
 * `offset` 只在一条事件写进发件箱之后才前进；重启后从 Telegram 保留的那一段里重放，
 * 重复的那些由发件箱按 `update_id` 去重（ADR-0015）。
 */
export function createTelegramRuntime(options: TelegramOptions): ListenerRuntime<TelegramHandle> {
	return {
		kind: telegramKind.kind,

		async open(listener, hooks) {
			const parsed = telegramListenerConfig.safeParse(listener.config);
			if (!parsed.success) {
				throw new ListenerUnready(listener.id, `invalid config: ${parsed.error.message}`);
			}
			const config = parsed.data;
			const bot = options.bots[listener.id];
			if (options.transport === undefined && bot === undefined) {
				throw new ListenerUnready(listener.id, "no token for this listener in the deployment");
			}
			const transport = options.transport ?? createTelegramTransport(bot as TelegramBot);

			const controller = new AbortController();
			const me = await getMe(listener.id, transport, controller.signal);
			void poll(listener.id, config, hooks, transport, controller);

			return {
				bot: me,
				close: async () => {
					controller.abort();
				},
			};
		},
	};
}

async function getMe(listener: string, transport: TelegramTransport, signal: AbortSignal): Promise<string> {
	try {
		const me = (await transport("getMe", {}, signal)) as { username?: string };
		return me.username ?? "unknown";
	} catch (error) {
		throw new ListenerUnready(listener, describe(error));
	}
}

async function poll(
	listener: string,
	config: TelegramListenerConfig,
	hooks: ListenerHooks,
	transport: TelegramTransport,
	controller: AbortController,
): Promise<void> {
	let offset = 0;
	const allowed = new Set(config.allowChats);

	while (!controller.signal.aborted) {
		let updates: TelegramUpdate[];
		try {
			const result = await transport(
				"getUpdates",
				{ offset, timeout: config.pollSeconds, allowed_updates: ["message"] },
				controller.signal,
			);
			updates = z.array(updateSchema).parse(result);
		} catch (error) {
			if (controller.signal.aborted) return;
			hooks.unready(describe(error));
			return; // 重开交给宿主
		}

		for (const update of updates) {
			const message = update.message;
			const sender = message?.from?.username ?? message?.from?.first_name;
			const relevant =
				message?.text !== undefined &&
				message.text !== "" &&
				(allowed.size === 0 || allowed.has(message.chat.id));
			if (relevant) {
				const body: TelegramMessage = {
					listener,
					text: message.text as string,
					chatId: message.chat.id,
					messageId: message.message_id,
					updateId: update.update_id,
					...(sender === undefined ? {} : { from: sender }),
				};
				try {
					await hooks.emit({ output: TELEGRAM_OUTPUT, body, eventId: String(update.update_id) });
				} catch (error) {
					// 没写进发件箱：不推进 offset，下次轮询 Telegram 会再给一遍。
					if (controller.signal.aborted) return;
					hooks.unready(describe(error));
					return;
				}
			}
			offset = Math.max(offset, update.update_id + 1);
		}
	}
}
