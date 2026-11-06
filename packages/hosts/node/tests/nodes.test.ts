import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import type { Message } from "@arbetslag/kernel";
import type { PerformContext } from "../src/executor.ts";
import type { TelegramTransport } from "../src/listeners/telegram.ts";
import { switchboard } from "../src/nodes/switchboard.ts";
import { telegramRelay } from "../src/nodes/telegramRelay.ts";
import { createTelegramSender, telegramSendKind } from "../src/performers/telegramSend.ts";

const board = switchboard.config.parse({
	template: "chat",
	params: { listener: "listener", chatId: "chatId" },
	trigger: "tg",
	eventId: "updateId",
});
const boardState = switchboard.state.parse(undefined);
const step = (message: Message) => switchboard.step({ self: "s", config: board, state: boardState, message });

test("the switchboard spawns by template name, with params and id taken from the event", () => {
	const body = { listener: "bot-a", chatId: 42, text: "hi", updateId: 9 };
	const transition = step({ type: "message", body });
	assert.deepEqual(transition.effects, [
		{
			kind: "workflow.spawn",
			input: {
				id: "chat:bot-a:42",
				template: "chat",
				params: { listener: "bot-a", chatId: 42 },
				forward: { trigger: "tg", output: "message", body, eventId: "9" },
			},
		},
	]);
	assert.equal(transition.state.spawned, 1);
});

test("an event missing a mapped field is skipped, not spawned", () => {
	const transition = step({ type: "message", body: { chatId: 1 } });
	assert.equal(transition.effects, undefined);
	assert.equal(transition.state.skipped, 1);
});

test("a failed spawn receipt is counted and kept, a good one changes nothing", () => {
	const failed = step({ type: "@effect.end", body: { result: { ok: false, error: 'no template "chat"' } } });
	assert.deepEqual(failed.state, { spawned: 0, skipped: 0, failed: 1, lastError: 'no template "chat"' });
	assert.deepEqual(step({ type: "@effect.end", body: { result: { ok: true, created: true } } }).state, boardState);
});

const relay = (message: Message) =>
	telegramRelay.step({
		self: "relay",
		config: { listener: "bot-a", chatId: 42 },
		state: null,
		message,
	});

test("the relay turns a chat message into user, and a reply into telegram.send on the same bot", () => {
	assert.deepEqual(relay({ type: "message", body: { listener: "bot-a", text: "hi", chatId: 42 } }).sends, [
		{ port: "user", body: { text: "hi" } },
	]);
	assert.deepEqual(relay({ type: "reply", body: { text: "  hello  ", message: {} } }).effects, [
		{ kind: "telegram.send", input: { listener: "bot-a", chatId: 42, text: "hello" } },
	]);
});

test("a blank reply is silence: nothing is sent", () => {
	assert.equal(relay({ type: "reply", body: { text: "   ", message: {} } }).effects, undefined);
});

const context = { signal: new AbortController().signal } as PerformContext;

test("telegram.send uses the listener's bot; an unknown bot is a failure result", async () => {
	const calls: { method: string; body: unknown }[] = [];
	const transport: TelegramTransport = async (method, body) => {
		calls.push({ method, body });
		return {} as JsonValue;
	};
	const send = createTelegramSender({ bots: {}, transport });
	assert.deepEqual(await send({ listener: "bot-a", chatId: 42, text: "hi" }, context), { ok: true });
	assert.deepEqual(calls, [{ method: "sendMessage", body: { chat_id: 42, text: "hi" } }]);

	const noBots = createTelegramSender({ bots: { "bot-a": { token: "t" } } });
	assert.deepEqual(await noBots({ listener: "bot-b", chatId: 1, text: "x" }, context), {
		ok: false,
		error: 'no bot "bot-b" in this deployment',
	});
	assert.equal(telegramSendKind.input.safeParse({ listener: "bot-a", chatId: 1, text: "" }).success, false);
});
