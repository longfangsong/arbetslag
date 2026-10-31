import assert from "node:assert/strict";
import { test } from "node:test";
import { completeEffect, deliverToNode, performGraphMutate, run } from "../../src/run/index.ts";
import { EFFECT_END, jsonSchema } from "../../src/message.ts";
import { deterministic, load, registry, setup } from "./fixtures.ts";
import type { InFlightEffect } from "../../src/effect/index.ts";
import { WorkflowNotFound } from "../../src/errors.ts";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import { createMemoryStore } from "../../src/memoryStore.ts";
import { createRegistry } from "../../src/registry.ts";
import { defineNode } from "../../src/nodeDefinition.ts";
import { createWorkflow } from "../../src/workflow/template/index.ts";

const single = { nodes: { e: { definition: "emitter", config: null } } };

test("an effect becomes an in-flight record before it leaves the graph", async () => {
	const { store, id } = await setup(single);
	await deliverToNode(store, id, "e", { type: "go", body: null });
	const result = await run(store, registry, id, deterministic());

	const expected: InFlightEffect = { effectId: "e1", origin: "e", kind: "timer.wait", input: { ms: 1 }, correlationId: "c1" };
	assert.deepEqual(result.effects, [expected]);
	assert.deepEqual((await load(store)).inFlight, [expected], "already in the saved snapshot when the run returns");
	assert.equal(result.status, "quiescent", "a run does not wait for effects");
});

test("the receipt lands in the origin's mailbox, carries the correlationId and the result", async () => {
	const { store, id } = await setup(single);
	await deliverToNode(store, id, "e", { type: "go", body: null });
	await run(store, registry, id, deterministic());

	assert.equal(await completeEffect(store, id, "e1", null), true);
	const s = await load(store);
	assert.deepEqual(s.inFlight, []);
	assert.deepEqual(s.graph.nodeStates.e?.mailbox, [
		{ seq: 1, message: { type: EFFECT_END, body: { correlationId: "c1", result: null } } },
	]);

	await run(store, registry, id);
	assert.deepEqual((await load(store)).graph.nodeStates.e?.state, { seen: ["receipt"] });
});

test("the in-flight record is a one-time token: a second receipt is dropped", async () => {
	const { store, id } = await setup(single);
	await deliverToNode(store, id, "e", { type: "go", body: null });
	await run(store, registry, id, deterministic());
	assert.equal(await completeEffect(store, id, "e1", null), true);
	assert.equal(await completeEffect(store, id, "e1", null), false);
	assert.equal((await load(store)).graph.nodeStates.e?.mailbox.length, 1);
});

test("a halted workflow still accepts receipts, but they do not run", async () => {
	const { store, id } = await setup({
		nodes: { e: { definition: "emitter", config: null }, f: { definition: "faulty", config: null } },
	});
	await deliverToNode(store, id, "e", { type: "go", body: null });
	await run(store, registry, id, deterministic());
	await deliverToNode(store, id, "f", { type: "throw", body: null });
	await run(store, registry, id);
	assert.equal((await load(store)).halted?.code, "step_threw");

	assert.equal(await completeEffect(store, id, "e1", null), true);
	const s = await load(store);
	assert.equal(s.graph.nodeStates.e?.mailbox.length, 1);
	assert.deepEqual((await run(store, registry, id)).steps, 0);
});

// —— graph.mutate ——

const spawner = defineNode({
	name: "spawner",
	version: 1,
	state: z.object({ results: z.array(jsonSchema) }).default({ results: [] }),
	config: z.null(),
	ports: () => ({ out: jsonSchema }),
	step: ({ state, message, self }) => {
		if (message.type === "grow") {
			const input: JsonValue = {
				ops: [
					{ op: "spawn", id: "child", definition: "spawner", config: null },
					{ op: "connect", from: "child", to: self, port: "out" },
				],
			};
			return { state, effects: [{ kind: "graph.mutate", correlationId: "grow", input }] };
		}
		if (message.type === "retire-self") {
			return { state, effects: [{ kind: "graph.mutate", input: { ops: [{ op: "retire", id: self }] } }] };
		}
		if (message.type === "bad-grow") {
			return { state, effects: [{ kind: "graph.mutate", input: { ops: [{ op: "retire", id: "ghost" }] } }] };
		}
		if (message.type === "@effect.end") return { state: { results: [...state.results, message.body as JsonValue] } };
		return { state };
	},
});
const mutateRegistry = createRegistry({ nodes: [spawner] });
const mutateSetup = async () => {
	const store = createMemoryStore();
	await createWorkflow(store, mutateRegistry, { nodes: { s: { definition: "spawner", config: null } } }, { id: "w" });
	return store;
};

test("graph.mutate: the change, the record removal and the receipt are one write", async () => {
	const store = await mutateSetup();
	await deliverToNode(store, "w", "s", { type: "grow", body: null });
	const { effects } = await run(store, mutateRegistry, "w", deterministic());
	const effectId = effects[0]?.effectId ?? "";

	assert.equal(await performGraphMutate(store, mutateRegistry, "w", effectId), "applied");

	const s = (await store.load("w"));
	assert.deepEqual(Object.keys(s?.graph.shape.nodes ?? {}).sort(), ["child", "s"]);
	assert.deepEqual(s?.graph.shape.edges, [{ from: "child", to: "s", port: "out" }]);
	assert.deepEqual(s?.inFlight, []);
	assert.deepEqual(s?.graph.nodeStates.s?.mailbox.map((m) => m.message), [
		{ type: EFFECT_END, body: { correlationId: "grow", result: { ok: true } } },
	]);
	// the new node exists and has an empty mailbox
	assert.deepEqual(s?.graph.nodeStates.child?.mailbox, []);

	assert.equal(await performGraphMutate(store, mutateRegistry, "w", effectId), "skipped", "token is spent");
});

test("graph.mutate: an invalid batch changes nothing but still answers with a failure receipt", async () => {
	const store = await mutateSetup();
	await deliverToNode(store, "w", "s", { type: "bad-grow", body: null });
	const { effects } = await run(store, mutateRegistry, "w", deterministic());
	assert.equal(await performGraphMutate(store, mutateRegistry, "w", effects[0]?.effectId ?? ""), "rejected");

	const s = (await store.load("w"));
	assert.deepEqual(Object.keys(s?.graph.shape.nodes ?? {}), ["s"]);
	assert.equal(s?.halted, undefined, "an illegal mutation is a failed effect, not a halt");
	await run(store, mutateRegistry, "w");
	const results = (await store.load("w"))?.graph.nodeStates.s?.state as { results: { result: { ok: boolean } }[] };
	assert.equal(results.results[0]?.result.ok, false);
});

test("graph.mutate: a node that retires itself gets no receipt, but the change is saved", async () => {
	const store = await mutateSetup();
	await deliverToNode(store, "w", "s", { type: "retire-self", body: null });
	const { effects } = await run(store, mutateRegistry, "w", deterministic());
	assert.equal(await performGraphMutate(store, mutateRegistry, "w", effects[0]?.effectId ?? ""), "applied");
	const s = (await store.load("w"));
	assert.deepEqual(s?.graph.shape.nodes, {});
	assert.deepEqual(s?.inFlight, []);
});

test("graph.mutate is skipped while the workflow is halted, so recovery can redo it later", async () => {
	const store = createMemoryStore();
	const reg = createRegistry({ nodes: [spawner] });
	await createWorkflow(store, reg, { nodes: { s: { definition: "spawner", config: null } } }, { id: "w" });
	await deliverToNode(store, "w", "s", { type: "grow", body: null });
	const { effects } = await run(store, reg, "w", deterministic());

	await store.commit("w", (snapshot) => ({
		snapshot: { ...snapshot, halted: { code: "step_threw", detail: "x", at: "2026-10-25T00:00:00.000Z" } },
		value: undefined,
	}));
	assert.equal(await performGraphMutate(store, reg, "w", effects[0]?.effectId ?? ""), "skipped");
	assert.equal((await store.load("w"))?.inFlight.length, 1);
});

test("a result for a workflow that is gone is `WorkflowNotFound`, not swallowed", async () => {
	const store = createMemoryStore();
	await assert.rejects(completeEffect(store, "nope", "e", null), WorkflowNotFound);
});
