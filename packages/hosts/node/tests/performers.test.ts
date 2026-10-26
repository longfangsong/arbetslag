import assert from "node:assert/strict";
import { test } from "node:test";
import type { InFlightEffect } from "@arbetslag/kernel";
import { timerKind, timerPerformer } from "../src/performers/timer.ts";

const anyEffect: InFlightEffect = {
	effectId: "e1",
	kind: "timer.wait",
	input: { ms: 1 },
	correlationId: "c1",
	origin: "n",
};

test("the timer kind declares an input schema and a null result", () => {
	assert.equal(timerKind.kind, "timer.wait");
	assert.equal(timerKind.input.safeParse({ ms: 1 }).success, true);
	assert.equal(timerKind.input.safeParse({ ms: -1 }).success, false);
	assert.equal(timerKind.result.safeParse(null).success, true);
	assert.equal(timerKind.result.safeParse({}).success, false);
});

test("the timer performer waits, then answers null", async () => {
	const started = Date.now();
	const result = await timerPerformer({ ms: 25 }, { workflowId: "w", effect: anyEffect });
	const waited = Date.now() - started;

	assert.equal(result, null);
	assert.ok(waited >= 20, `waited ${waited}ms`);
});

test("ms: 0 does not wait at all", async () => {
	assert.equal(await timerPerformer({ ms: 0 }, { workflowId: "w", effect: anyEffect }), null);
});
