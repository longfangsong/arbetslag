import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineNode } from "../src/nodeDefinition.ts";
import { createRegistry } from "../src/registry.ts";

const counter = defineNode({
	name: "counter",
	version: 2,
	state: z.object({ n: z.number() }),
	config: z.object({ step: z.number() }),
	ports: (config) => ({ count: z.number(), [`x${config.step}`]: z.null() }),
	step: ({ state, config, message }) => {
		switch (message.type) {
			case "inc":
				return {
					state: { n: state.n + config.step },
					sends: [{ port: "count", body: state.n + config.step }],
				};
			default:
				return { state };
		}
	},
	migrate: (old) => {
		const n = (old as { n?: unknown }).n;
		return { n: typeof n === "number" ? n : 0 };
	},
});

test("step is a plain function of (state, config, message)", () => {
	const out = counter.step({ self: "c", config: { step: 2 }, state: { n: 1 }, message: { type: "inc", body: null } });
	assert.deepEqual(out, { state: { n: 3 }, sends: [{ port: "count", body: 3 }] });
	const ignored = counter.step({ self: "c", config: { step: 2 }, state: { n: 1 }, message: { type: "other", body: null } });
	assert.deepEqual(ignored, { state: { n: 1 } });
});

test("ports are a pure function of config", () => {
	assert.deepEqual(Object.keys(counter.ports({ step: 1 })), ["count", "x1"]);
	assert.deepEqual(Object.keys(counter.ports({ step: 5 })), ["count", "x5"]);
});

test("migrate maps an old state to the current shape", () => {
	assert.deepEqual(counter.migrate?.({ n: 4, junk: true }, 1), { n: 4 });
});

test("registry looks up by name and rejects duplicates and reserved names", () => {
	const effect = { kind: "timer.wait", input: z.object({ ms: z.number() }), result: z.null() };
	const registry = createRegistry({ nodes: [counter], effects: [effect] });
	assert.equal(registry.node("counter"), counter);
	assert.equal(registry.node("missing"), undefined);
	assert.equal(registry.effectKind("timer.wait"), effect);
	assert.equal(registry.triggerKind("webhook"), undefined);

	assert.throws(() => createRegistry({ nodes: [counter, counter] }), /duplicate node definition/);
	assert.throws(() => createRegistry({ effects: [{ ...effect, kind: "@x" }] }), /invalid effect kind/);
});
