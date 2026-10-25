import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidDelivery, WorkflowNotFound } from "../../src/errors.ts";
import { deliverFromTrigger, deliverToNode, run } from "../../src/run/index.ts";
import { load, registry, setup } from "./fixtures.ts";

const withTrigger = {
	nodes: { a: { definition: "relay", config: null } },
	edges: [{ from: "t", to: "a", port: "text" }],
	triggers: [{ id: "t", kind: "hook", config: {} }],
};

test("deliverToNode appends to the target mailbox with the next seq and no sender", async () => {
	const { store, id } = await setup();
	await deliverToNode(store, id, "a", { type: "in", body: { n: 1 } });
	await deliverToNode(store, id, "b", { type: "in", body: { n: 2 } });
	const s = await load(store);
	assert.deepEqual(s.graph.nodeStates.a?.mailbox, [{ seq: 0, message: { type: "in", body: { n: 1 } } }]);
	assert.deepEqual(s.graph.nodeStates.b?.mailbox, [{ seq: 1, message: { type: "in", body: { n: 2 } } }]);
	assert.equal(s.nextSeq, 2);
});

test("delivery is refused for unknown workflows, unknown nodes and reserved types", async () => {
	const { store, id } = await setup();
	await assert.rejects(deliverToNode(store, "nope", "a", { type: "in", body: null }), WorkflowNotFound);
	await assert.rejects(deliverToNode(store, id, "ghost", { type: "in", body: null }), InvalidDelivery);
	await assert.rejects(deliverToNode(store, id, "a", { type: "@effect.end", body: null }), InvalidDelivery);
	await assert.rejects(deliverToNode(store, id, "a", { type: "", body: null }), InvalidDelivery);
	assert.equal((await load(store)).nextSeq, 0);
});

test("a trigger delivery follows the edge from the trigger's output", async () => {
	const { store, id } = await setup(withTrigger);
	assert.equal(await deliverFromTrigger(store, registry, id, "t", "text", "hello"), true);
	const s = await load(store);
	assert.deepEqual(s.graph.nodeStates.a?.mailbox, [{ seq: 0, message: { type: "text", body: "hello" } }]);
	assert.equal((await run(store, registry, id)).status, "quiescent");
});

test("a trigger body that does not match the declared output is refused, not halted", async () => {
	const { store, id } = await setup(withTrigger);
	await assert.rejects(deliverFromTrigger(store, registry, id, "t", "text", 42), InvalidDelivery);
	await assert.rejects(deliverFromTrigger(store, registry, id, "t", "nope", "x"), InvalidDelivery);
	await assert.rejects(deliverFromTrigger(store, registry, id, "ghost", "text", "x"), InvalidDelivery);
	const s = await load(store);
	assert.equal(s.halted, undefined);
	assert.equal(s.nextSeq, 0);
});

test("an unwired trigger output drops the event and logs it", async () => {
	const { store, log, id } = await setup({ ...withTrigger, edges: [] });
	const delivered = await deliverFromTrigger(store, registry, id, "t", "text", "hello", { log });
	assert.equal(delivered, false);
	assert.deepEqual(
		log.entries.get(id)?.map((e) => [e.type, (e as { from: string }).from]),
		[["dropped", "t"]],
	);
	assert.equal((await load(store)).nextSeq, 0);
});
