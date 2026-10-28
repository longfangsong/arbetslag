import type { JsonValue } from "type-fest";
import { z } from "zod";
import type { TriggerKindDefinition } from "@arbetslag/kernel";
import {
	type TriggerHandle,
	type TriggerHooks,
	type TriggerRuntime,
	TriggerUnready,
} from "./runtime.ts";

/**
 * telegram 这种触发器：一条 `getUpdates` 长轮询，把带文字的聊天消息投进来。
 *
 * 密钥**不进声明**：声明会落进**快照**、会被观察，所以 token 从 runtime 的选项里给
 * （部署的配置，不是工作流的配置）。
 */
export type TelegramConfig = {
	/** 输出名 = 投给节点的消息类别（ADR-0001）。默认 `message`。 */
	output: string;
	/** 长轮询等多久（Telegram 上限 50 秒）。默认 25。 */
	pollSeconds: number;
	/** 只收这些 chat（留空表示都收）。 */
	allowChats: number[];
};

/** 投给节点的那条消息的载荷：文字 + 它从哪个聊天来。 */
export type TelegramMessage = {
	text: string;
	chatId: number;
	messageId: number;
	/** 发件人的展示名，方便日志。 */
	from?: string;
};

export const telegramKind: TriggerKindDefinition<TelegramConfig> = {
	kind: "telegram",
	config: z.object({
		output: z.string().min(1).default("message"),
		pollSeconds: z.number().int().min(1).max(50).default(25),
		allowChats: z.array(z.number().int()).default([]),
	}),
	outputs: (config) => ({
		[config.output]: z.object({
			text: z.string().min(1),
			chatId: z.number().int(),
			messageId: z.number().int(),
			from: z.string().optional(),
		}),
	}),
};

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

export type TelegramOptions = {
	token: string;
	/** 默认 `https://api.telegram.org`；自建网关改这里。 */
	apiBase?: string;
	transport?: TelegramTransport;
};

export type TelegramHandle = TriggerHandle & { bot: string };

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function createTransport(apiBase: string, token: string): TelegramTransport {
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
 * 一个触发器一条长轮询：`getUpdates` → 投递 → `offset` 前进。
 *
 * `open` 先用 `getMe` 探一下：token 不对、或者这个 bot 上还挂着 webhook（409），
 * 都抛 `TriggerUnready`（→ 未就绪，宿主重试），不停住工作流。
 * 轮询中途出错（网络断了）走 `hooks.unready`，然后这条监听自己停下——重建交给对账。
 *
 * 游标只在内存里（`CONTEXT.md`：触发器自己的游标不属于快照）；重启后从 Telegram
 * 保留的那一段里重放，所以投递是 at-least-once。
 */
export function createTelegramRuntime(options: TelegramOptions): TriggerRuntime<TelegramHandle> {
	const transport = options.transport ?? createTransport(options.apiBase ?? "https://api.telegram.org", options.token);

	return {
		kind: telegramKind.kind,

		async open(declaration, hooks) {
			const parsed = telegramKind.config.safeParse(declaration.config);
			if (!parsed.success) {
				throw new TriggerUnready(declaration.id, `invalid config: ${parsed.error.message}`);
			}
			const config = parsed.data;

			const controller = new AbortController();
			const me = await getMe(declaration.id, transport, controller.signal);
			void poll(config, hooks, transport, controller);

			return {
				bot: me,
				close: async () => {
					controller.abort();
				},
			};
		},
	};
}

async function getMe(trigger: string, transport: TelegramTransport, signal: AbortSignal): Promise<string> {
	try {
		const me = (await transport("getMe", {}, signal)) as { username?: string };
		return me.username ?? "unknown";
	} catch (error) {
		throw new TriggerUnready(trigger, describe(error));
	}
}

async function poll(
	config: TelegramConfig,
	hooks: TriggerHooks,
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
			return; // 重建交给对账
		}

		for (const update of updates) {
			offset = Math.max(offset, update.update_id + 1);
			const message = update.message;
			if (message?.text === undefined || message.text === "") continue;
			if (allowed.size > 0 && !allowed.has(message.chat.id)) continue;

			const sender = message.from?.username ?? message.from?.first_name;
			const body: TelegramMessage = {
				text: message.text,
				chatId: message.chat.id,
				messageId: message.message_id,
				...(sender === undefined ? {} : { from: sender }),
			};
			await hooks.deliver(config.output, body);
		}
	}
}
