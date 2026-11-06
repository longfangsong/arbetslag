import assert from "node:assert/strict";
import { test } from "node:test";
import { type ModelCall, type ModelCompleteInput, providerCall } from "../src/index.ts";

const answer =
	(name: string): ModelCall =>
	async () => ({ ok: true, message: { role: "assistant", blocks: [{ type: "text", text: name }] } });

const ask = (call: ModelCall, provider?: string) => {
	const input: ModelCompleteInput = { model: "m", messages: [], tools: [], ...(provider === undefined ? {} : { provider }) };
	return call({ input, workflowId: "w" });
};

test("providerCall picks the named provider", async () => {
	const call = providerCall({ a: answer("a"), b: answer("b") });
	assert.deepEqual(await ask(call, "b"), { ok: true, message: { role: "assistant", blocks: [{ type: "text", text: "b" }] } });
});

test("providerCall uses the only provider when none is named", async () => {
	const call = providerCall({ only: answer("only") });
	const result = await ask(call);
	assert.equal(result.ok, true);
});

test("an unknown or missing provider is a failure result, not a throw", async () => {
	const call = providerCall({ a: answer("a"), b: answer("b") });
	assert.deepEqual(await ask(call, "c"), { ok: false, error: 'no provider "c"; this deployment has ["a","b"]' });
	assert.deepEqual(await ask(call), { ok: false, error: 'no provider given; this deployment has ["a","b"]' });
});
