import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { Snapshot } from "../src/workflow/snapshot.ts";
import { Conflict } from "../src/snapshotStore.ts";

const snap = (nextSeq = 0): Snapshot => ({
	graph: { shape: { nodes: {}, edges: [], triggers: [] }, nodeStates: {} },
	inFlight: [],
	nextSeq,
});

const conflictReason = (p: Promise<unknown>) =>
	p.then(
		() => "no conflict",
		(e) => (e instanceof Conflict ? e.reason : `other: ${e}`),
	);

test("load of an unknown id is undefined", async () => {
	assert.equal(await createMemoryStore().load("w"), undefined);
});

test("create then load round-trips the snapshot and its revision", async () => {
	const store = createMemoryStore();
	const rev = await store.save("w", snap(3), null);
	assert.deepEqual(await store.load("w"), { snapshot: snap(3), revision: rev });
});

test("creating an id that exists is a conflict, not a reuse", async () => {
	const store = createMemoryStore();
	await store.save("w", snap(), null);
	assert.equal(await conflictReason(store.save("w", snap(), null)), "exists");
});

test("update needs the current revision; each write changes it", async () => {
	const store = createMemoryStore();
	const r1 = await store.save("w", snap(1), null);
	const r2 = await store.save("w", snap(2), r1);
	assert.notEqual(r1, r2);
	assert.equal(await conflictReason(store.save("w", snap(3), r1)), "stale");
	assert.equal((await store.load("w"))?.snapshot.nextSeq, 2);
});

test("drop removes the record; a late writer gets `missing`; drop is idempotent", async () => {
	const store = createMemoryStore();
	const r1 = await store.save("w", snap(), null);
	await store.drop("w");
	await store.drop("w");
	assert.equal(await store.load("w"), undefined);
	assert.equal(await conflictReason(store.save("w", snap(), r1)), "missing");
	// a dropped id can be created again; no tombstone
	await store.save("w", snap(), null);
});

test("callers cannot reach into the stored record", async () => {
	const store = createMemoryStore();
	const input = snap(1);
	const rev = await store.save("w", input, null);
	input.nextSeq = 99;
	const loaded = await store.load("w");
	assert.equal(loaded?.snapshot.nextSeq, 1);
	loaded!.snapshot.nextSeq = 42;
	assert.equal((await store.load("w"))?.snapshot.nextSeq, 1);
	assert.ok(rev);
});
