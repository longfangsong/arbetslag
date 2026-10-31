import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkflowHalted } from "../../src/errors.ts";
import type { SnapshotStore } from "../../src/snapshotStore.ts";
import { deliverToNode, resume, run } from "../../src/run/index.ts";
import type { LogEntry } from "../../src/transitionLog.ts";
import { chain, deterministic, load, registry, setup } from "./fixtures.ts";

const names = (entries: LogEntry[] | undefined) =>
	(entries ?? []).filter((e) => e.type === "transition").map((e) => (e as { node: string }).node);

test("a delivery flows along the edges until the graph is quiescent", async () => {
	const { store, id } = await setup();
	await deliverToNode(store, id, "a", { type: "in", body: "hi" });
	const result = await run(store, registry, id);
	assert.deepEqual(result, { status: "quiescent", steps: 3, effects: [] });

	const s = await load(store);
	assert.deepEqual(
		["a", "b", "c"].map((n) => s.graph.nodeStates[n]?.state),
		[{ count: 1 }, { count: 1 }, { count: 1 }],
	);
	assert.ok(Object.values(s.graph.nodeStates).every((n) => n.mailbox.length === 0));
});

test("messages are processed in global enqueue order, not by node", async () => {
	const { store, log, id } = await setup();
	await deliverToNode(store, id, "c", { type: "in", body: 1 }); // seq 0
	await deliverToNode(store, id, "a", { type: "in", body: 2 }); // seq 1
	await deliverToNode(store, id, "b", { type: "in", body: 3 }); // seq 2
	await run(store, registry, id, { log });
	// c(0) a(1) b(2) first; then a's output reaches b as seq 3, and b's two outputs reach c as 4 and 5
	assert.deepEqual(names(log.entries.get(id)), ["c", "a", "b", "b", "c", "c"]);
});

test("running a quiescent workflow writes nothing", async () => {
	const { store, id } = await setup();
	let writes = 0;
	const counting: SnapshotStore = {
		...store,
		async commit(i, change) {
			return store.commit(i, (snapshot) => {
				const result = change(snapshot);
				if (result.snapshot !== undefined) writes++;
				return result;
			});
		},
	};

	const result = await run(counting, registry, id);
	assert.deepEqual(result, { status: "quiescent", steps: 0, effects: [] });
	assert.equal(writes, 0, "no change, no write");
});

test("the budget stops a run mid-way: not a halt, and the next run carries on", async () => {
	const { store, id } = await setup({
		nodes: { x: { definition: "relay", config: null }, y: { definition: "relay", config: null } },
		edges: [
			{ from: "x", to: "y", port: "out" },
			{ from: "y", to: "x", port: "out" },
		],
	});
	await deliverToNode(store, id, "x", { type: "in", body: null });

	const first = await run(store, registry, id, { budget: 5 });
	assert.deepEqual([first.status, first.steps], ["budget", 5]);
	assert.equal((await load(store)).halted, undefined);

	const second = await run(store, registry, id, { budget: 3 });
	assert.deepEqual([second.status, second.steps], ["budget", 3]);
	const counts = (await load(store)).graph.nodeStates;
	assert.equal((counts.x?.state as { count: number }).count + (counts.y?.state as { count: number }).count, 8);
});

test("a message with no edge is dropped and logged, never an error", async () => {
	const { store, log, id } = await setup();
	await deliverToNode(store, id, "c", { type: "in", body: 1 }); // c.out is unwired
	await run(store, registry, id, { log });
	assert.deepEqual(
		log.entries.get(id)?.filter((e) => e.type === "dropped").map((e) => ({ ...e, at: "" })),
		[{ type: "dropped", from: "c", port: "out", reason: "no_edge", at: "" }],
	);
	assert.equal((await load(store)).halted, undefined);
});

test("an explicit target needs no edge; a missing target is dropped", async () => {
	const { store, log, id } = await setup({
		nodes: { f: { definition: "faulty", config: null }, r: { definition: "relay", config: null } },
	});
	await deliverToNode(store, id, "f", { type: "direct", body: "r" });
	await run(store, registry, id);
	assert.deepEqual((await load(store)).graph.nodeStates.r?.state, { count: 1 });

	await deliverToNode(store, id, "f", { type: "direct", body: "ghost" });
	await run(store, registry, id, { log });
	assert.deepEqual(log.entries.get(id)?.filter((e) => e.type === "dropped").map((e) => (e as { reason: string }).reason), ["no_target"]);
});

test("the transition log records transitions and is not part of the snapshot", async () => {
	const { store, log, id } = await setup();
	await deliverToNode(store, id, "a", { type: "in", body: 1 });
	await run(store, registry, id, { log, ...deterministic() });
	const entries = log.entries.get(id) ?? [];
	assert.equal(entries.filter((e) => e.type === "transition").length, 3);
	assert.equal(JSON.stringify(await load(store)).includes("transition"), false);
});

test("resume on a workflow that is not halted does nothing", async () => {
	const { store, id } = await setup();
	assert.equal(await resume(store, id), false);
});

test("a halted workflow is inert: run does nothing, delivery is refused", async () => {
	const { store, id } = await setup({ nodes: { f: { definition: "faulty", config: null } } });
	await deliverToNode(store, id, "f", { type: "throw", body: null });
	const result = await run(store, registry, id, deterministic());
	assert.deepEqual([result.status, result.steps], ["halted", 0]);

	const s = await load(store);
	assert.equal(s.halted?.code, "step_threw");
	assert.equal(s.halted?.node, "f");
	assert.equal(s.graph.nodeStates.f?.mailbox.length, 1, "the failed transition did not commit: message still at the head");

	const again = await run(store, registry, id);
	assert.deepEqual([again.status, again.steps], ["halted", 0]);
	await assert.rejects(deliverToNode(store, id, "f", { type: "x", body: null }), WorkflowHalted);
});

test("resume clears only the flag; a poison message halts again right away", async () => {
	const { store, id } = await setup({ nodes: { f: { definition: "faulty", config: null } } });
	await deliverToNode(store, id, "f", { type: "throw", body: null });
	await run(store, registry, id);
	assert.equal(await resume(store, id), true);
	assert.equal((await load(store)).halted, undefined);
	assert.equal((await load(store)).graph.nodeStates.f?.mailbox.length, 1);

	const result = await run(store, registry, id);
	assert.equal(result.status, "halted");
});

for (const [messageType, code] of [
	["throw", "step_threw"],
	["not-a-transition", "step_threw"],
	["bad-state", "state_invalid"],
	["reserved", "reserved_port"],
	["undeclared", "send_invalid"],
	["bad-body", "send_invalid"],
	["unknown-effect", "effect_invalid"],
	["bad-effect-input", "effect_invalid"],
] as const) {
	test(`halt code: ${messageType} -> ${code}`, async () => {
		const { store, id } = await setup({ nodes: { f: { definition: "faulty", config: null } } });
		await deliverToNode(store, id, "f", { type: messageType, body: null });
		const result = await run(store, registry, id);
		assert.equal(result.status, "halted");
		const s = await load(store);
		assert.equal(s.halted?.code, code);
		assert.equal(s.nextSeq, 1, "nothing was committed");
		assert.equal(s.inFlight.length, 0);
	});
}

test("a failed transition leaves no trace: its sends are not delivered either", async () => {
	const { store, id } = await setup({
		nodes: { f: { definition: "faulty", config: null }, r: { definition: "relay", config: null } },
		edges: [{ from: "f", to: "r", port: "out" }],
	});
	await deliverToNode(store, id, "f", { type: "send-then-fail", body: null });
	await run(store, registry, id);
	const s = await load(store);
	assert.equal(s.halted?.code, "state_invalid");
	assert.equal(s.graph.nodeStates.r?.mailbox.length, 0);
});

test("transitions committed before the failure are kept", async () => {
	const { store, id } = await setup({
		nodes: { r: { definition: "relay", config: null }, f: { definition: "faulty", config: null } },
	});
	await deliverToNode(store, id, "r", { type: "in", body: 1 }); // seq 0, fine
	await deliverToNode(store, id, "f", { type: "throw", body: null }); // seq 1, halts
	const result = await run(store, registry, id);
	assert.deepEqual([result.status, result.steps], ["halted", 1]);
	assert.deepEqual((await load(store)).graph.nodeStates.r?.state, { count: 1 });
});

test("a snapshot over the size limit halts instead of being written", async () => {
	const { store, id } = await setup();
	await deliverToNode(store, id, "a", { type: "in", body: "x".repeat(2000) });
	const result = await run(store, registry, id, { maxSnapshotBytes: 1500 });
	assert.equal(result.status, "halted");
	const s = await load(store);
	assert.equal(s.halted?.code, "snapshot_too_large");
	assert.equal(s.graph.nodeStates.a?.mailbox.length, 1);
});

test("chain fixture is what the tests assume", () => {
	assert.equal(Object.keys(chain.nodes).length, 3);
});
