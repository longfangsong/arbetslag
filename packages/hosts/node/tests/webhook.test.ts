import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { TriggerUnready } from "../src/triggers/runtime.ts";
import { createWebhookRuntime, webhookKind } from "../src/triggers/webhook.ts";

type Hooks = Parameters<ReturnType<typeof createWebhookRuntime>["open"]>[1];

function recorder() {
	const delivered: { output: string; body: JsonValue }[] = [];
	const unready: string[] = [];
	const hooks: Hooks = {
		deliver: async (output, body) => {
			delivered.push({ output, body });
			return null;
		},
		unready: (reason) => {
			unready.push(reason);
		},
	};
	return { delivered, unready, hooks };
}

async function open(hooks: Hooks, config: Record<string, JsonValue> = {}) {
	return createWebhookRuntime().open(
		{ id: "hook", kind: "webhook", config: { port: 0, path: "/hook", ...config } },
		hooks,
	);
}

const post = (port: number, path: string, body: string) =>
	fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		body,
		headers: { "content-type": "application/json" },
	});

test("a POST on the declared path is delivered under the declared output name", async () => {
	const { delivered, hooks } = recorder();
	const handle = await open(hooks);
	try {
		assert.ok(handle.port > 0, "port 0 means the system picked one, and the handle reports it");

		const response = await post(handle.port, "/hook", JSON.stringify({ text: "你好" }));

		assert.equal(response.status, 200);
		assert.deepEqual(delivered, [{ output: "request", body: { text: "你好" } }]);
	} finally {
		await handle.close();
	}
});

test("the output name is part of the config, so the edge can wire it to any message type", async () => {
	const { delivered, hooks } = recorder();
	const handle = await open(hooks, { output: "chat" });
	try {
		await post(handle.port, "/hook", JSON.stringify({ text: "hi" }));
		assert.equal(delivered[0]?.output, "chat");
		assert.deepEqual(Object.keys(webhookKind.outputs({ port: 8787, path: "/", output: "chat" })), ["chat"]);
	} finally {
		await handle.close();
	}
});

test("other paths and methods are 404, and nothing is delivered", async () => {
	const { delivered, hooks } = recorder();
	const handle = await open(hooks);
	try {
		assert.equal((await post(handle.port, "/other", "{}")).status, 404);
		assert.equal((await fetch(`http://127.0.0.1:${handle.port}/hook`)).status, 404);
		assert.deepEqual(delivered, []);
	} finally {
		await handle.close();
	}
});

test("a body that is not JSON is rejected with 400, not delivered", async () => {
	const { delivered, hooks } = recorder();
	const handle = await open(hooks);
	try {
		assert.equal((await post(handle.port, "/hook", "not json")).status, 400);
		assert.equal((await post(handle.port, "/hook", "  ")).status, 400);
		assert.deepEqual(delivered, []);
	} finally {
		await handle.close();
	}
});

test("a rejected delivery answers 503 with the reason", async () => {
	const hooks: Hooks = {
		deliver: async () => {
			throw new Error("workflow is halted");
		},
		unready: () => {},
	};
	const handle = await open(hooks);
	try {
		const response = await post(handle.port, "/hook", "{}");
		assert.equal(response.status, 503);
		const body = (await response.json()) as { ok: boolean; error: string };
		assert.deepEqual(body, { ok: false, error: "workflow is halted", trigger: "hook" });
	} finally {
		await handle.close();
	}
});

test("a port that is already taken is unready, not a crash", async () => {
	const first = await open(recorder().hooks);
	try {
		await assert.rejects(
			open(recorder().hooks, { port: first.port }),
			(error: unknown) => error instanceof TriggerUnready && error.trigger === "hook",
		);
		// 第一个还活着：端口冲突不该连累已经起好的监听。
		assert.equal((await post(first.port, "/hook", "{}")).status, 200);
	} finally {
		await first.close();
	}
});

test("a config that does not match the kind is unready", async () => {
	await assert.rejects(
		createWebhookRuntime().open({ id: "hook", kind: "webhook", config: { port: "eighty" } }, recorder().hooks),
		(error: unknown) => error instanceof TriggerUnready && error.reason.startsWith("invalid config"),
	);
});
