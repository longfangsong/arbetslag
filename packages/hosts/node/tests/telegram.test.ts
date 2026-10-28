import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import type { Trigger } from "@arbetslag/kernel";
import { type TelegramTransport, TriggerUnready, createTelegramRuntime, telegramKind } from "../src/index.ts";

type Call = { method: string; body: unknown };

/** 一次"长轮询没有新消息"：等到被关掉为止。 */
const idle = (signal: AbortSignal): Promise<JsonValue> =>
	new Promise((_resolve, reject) => {
		signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
	});

/** 一个假的 Telegram：按预设回答，并记下每次调用。 */
function fakeTransport(answers: (method: string, call: number, signal: AbortSignal) => unknown) {
	const calls: Call[] = [];
	const transport: TelegramTransport = async (method, body, signal) => {
		calls.push({ method, body });
		const answer = answers(method, calls.filter((call) => call.method === method).length - 1, signal);
		if (answer instanceof Error) throw answer;
		return answer as JsonValue;
	};
	return { transport, calls };
}

const declaration = (config: JsonValue = {}): Trigger => ({ id: "tg", kind: "telegram", config });

const hooks = () => {
	const delivered: { output: string; body: JsonValue }[] = [];
	const unready: string[] = [];
	return {
		delivered,
		unready,
		hooks: {
			deliver: async (output: string, body: JsonValue) => {
				delivered.push({ output, body });
			},
			unready: (reason: string) => {
				unready.push(reason);
			},
		},
	};
};

/** 等到条件成立（长轮询是后台循环，投递不发生在 `open` 的返回里）。 */
async function until(check: () => boolean, ms = 1000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

const message = (updateId: number, chatId: number, text: string) => ({
	update_id: updateId,
	message: {
		message_id: updateId,
		chat: { id: chatId },
		from: { username: "longfangsong" },
		text,
	},
});

test("config defaults: one output called message, 25s polls, every chat", () => {
	const config = telegramKind.config.parse({});
	assert.deepEqual(config, { output: "message", pollSeconds: 25, allowChats: [] });
	assert.deepEqual(Object.keys(telegramKind.outputs(config)), ["message"]);
	assert.equal(
		telegramKind.outputs(config).message?.safeParse({ text: "hi", chatId: 1, messageId: 2 }).success,
		true,
	);
	assert.equal(telegramKind.outputs(config).message?.safeParse({ text: "" }).success, false);
	assert.equal(telegramKind.config.safeParse({ pollSeconds: 60 }).success, false, "Telegram caps long polls");
});

test("a text message is delivered with its chat and id, and the offset moves on", async () => {
	const { transport, calls } = fakeTransport((method, call, signal) => {
		if (method === "getMe") return { username: "dev_bot" };
		if (call === 0) return [message(7, 42, "你好")];
		return idle(signal); // 之后再无更新：卡在长轮询上，直到被关掉
	});
	const seen = hooks();
	const runtime = createTelegramRuntime({ token: "t", transport });

	const handle = await runtime.open(declaration({ output: "chat" }), seen.hooks);
	assert.equal(handle.bot, "dev_bot");
	await until(() => seen.delivered.length === 1);

	assert.deepEqual(seen.delivered[0], {
		output: "chat",
		body: { text: "你好", chatId: 42, messageId: 7, from: "longfangsong" },
	});

	const updates = calls.filter((call) => call.method === "getUpdates");
	await until(() => updates.length >= 2);
	assert.equal((updates[0]?.body as { offset: number }).offset, 0);
	assert.equal((updates[1]?.body as { offset: number }).offset, 8, "next poll starts after the last update");
	assert.deepEqual((updates[0]?.body as { allowed_updates: string[] }).allowed_updates, ["message"]);

	await handle.close();
});

test("messages without text are skipped, and allowChats filters the rest", async () => {
	const { transport } = fakeTransport((method, call, signal) => {
		if (method === "getMe") return { username: "bot" };
		if (call === 0)
			return [
				{ update_id: 1, message: { message_id: 1, chat: { id: 1 }, sticker: {} } },
				message(2, 1, "留下的"),
				message(3, 999, "别家的"),
				{ update_id: 4, edited_message: { message_id: 4, chat: { id: 1 }, text: "改过的" } },
			];
		return idle(signal);
	});
	const seen = hooks();
	const runtime = createTelegramRuntime({ token: "t", transport });
	const handle = await runtime.open(declaration({ allowChats: [1] }), seen.hooks);

	await until(() => seen.delivered.length === 1);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(
		seen.delivered.map((entry) => (entry.body as { text: string }).text),
		["留下的"],
	);
	await handle.close();
});

test("a bad token or an active webhook is unready, not a halt", async () => {
	const { transport } = fakeTransport(() => new Error("Unauthorized"));
	const runtime = createTelegramRuntime({ token: "t", transport });

	await assert.rejects(
		() => runtime.open(declaration(), hooks().hooks),
		(error: unknown) => error instanceof TriggerUnready && /Unauthorized/.test(error.reason),
	);
});

test("a poll that fails later reports unready and stops itself", async () => {
	const { transport } = fakeTransport((method, call) => {
		if (method === "getMe") return { username: "bot" };
		if (call === 0) return [message(1, 1, "第一句")];
		return new Error("Conflict: can't use getUpdates method while webhook is active");
	});
	const seen = hooks();
	const runtime = createTelegramRuntime({ token: "t", transport });
	const handle = await runtime.open(declaration(), seen.hooks);

	await until(() => seen.unready.length === 1);
	assert.match(seen.unready[0] ?? "", /webhook is active/);
	assert.equal(seen.delivered.length, 1, "the message that arrived before the failure is kept");

	await handle.close();
});
