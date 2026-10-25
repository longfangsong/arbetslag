import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { checkEffects, makeReceipt, receiptBodySchema, type InFlightEffect } from "../src/effect/index.ts";
import { EFFECT_END, messageSchema } from "../src/message.ts";
import { createRegistry } from "../src/registry.ts";

const registry = createRegistry({
	effects: [
		{ kind: "timer.wait", input: z.object({ ms: z.number() }), result: z.null() },
	],
});

test("known kind with a valid input passes", () => {
	assert.deepEqual(checkEffects(registry, [{ kind: "timer.wait", input: { ms: 5 } }]), []);
});

test("unknown kind and invalid input are reported with their index", () => {
	const v = checkEffects(registry, [
		{ kind: "timer.wait", input: { ms: 5 } },
		{ kind: "nope", input: null },
		{ kind: "timer.wait", input: { ms: "5" } },
	]);
	assert.deepEqual(
		v.map((x) => [x.code, x.index]),
		[
			["effect_kind_unknown", 1],
			["effect_input_invalid", 2],
		],
	);
	assert.match((v[1] as { detail: string }).detail, /ms/);
});

const inFlight: InFlightEffect = {
	effectId: "e1",
	origin: "agent",
	kind: "timer.wait",
	input: { ms: 5 },
	correlationId: "timeout-3",
};

test("receipt is an @effect.end message without `from`, wrapping the result", () => {
	const msg = makeReceipt(inFlight, null);
	assert.deepEqual(msg, { type: EFFECT_END, body: { correlationId: "timeout-3", result: null } });
	assert.ok(messageSchema.safeParse(msg).success);
	assert.ok(receiptBodySchema.safeParse(msg.body).success);
	assert.equal("from" in msg, false);
});

test("receipt omits correlationId when the request had none", () => {
	const { correlationId: _, ...bare } = inFlight;
	assert.deepEqual(makeReceipt(bare, { ok: true }).body, { result: { ok: true } });
});
