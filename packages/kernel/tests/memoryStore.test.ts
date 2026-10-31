import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkflowExists, WorkflowNotFound } from "../src/errors.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { Snapshot } from "../src/workflow/snapshot.ts";

const snap = (nextSeq = 0): Snapshot => ({
	graph: { shape: { nodes: {}, edges: [], triggers: [] }, nodeStates: {} },
	inFlight: [],
	nextSeq,
});

const rejection = (p: Promise<unknown>) =>
	p.then(
		() => "no error",
		(e) => (e instanceof WorkflowExists ? "exists" : e instanceof WorkflowNotFound ? "missing" : `other: ${e}`),
	);

test("load of an unknown id is undefined", async () => {
	assert.equal(await createMemoryStore().load("w"), undefined);
});

test("create then load round-trips the snapshot", async () => {
	const store = createMemoryStore();
	await store.create("w", snap(3));
	assert.deepEqual(await store.load("w"), snap(3));
});

test("creating an id that exists is refused, not reused", async () => {
	const store = createMemoryStore();
	await store.create("w", snap());
	assert.equal(await rejection(store.create("w", snap())), "exists");
});

test("commit hands the change the current snapshot and writes back what it returns", async () => {
	const store = createMemoryStore();
	await store.create("w", snap(1));

	const seen = await store.commit("w", (snapshot) => {
		assert.equal(snapshot.nextSeq, 1);
		return { snapshot: { ...snapshot, nextSeq: 2 }, value: "done" };
	});

	assert.equal(seen, "done");
	assert.equal((await store.load("w"))?.nextSeq, 2);
});

test("commit on a missing id is `missing`; drop is idempotent and leaves no tombstone", async () => {
	const store = createMemoryStore();
	await store.create("w", snap());
	await store.drop("w");
	await store.drop("w");
	assert.equal(await store.load("w"), undefined);
	assert.equal(await rejection(store.commit("w", (s) => ({ snapshot: s, value: undefined }))), "missing");
	// a dropped id can be created again
	await store.create("w", snap());
});

test("a change that decides not to write leaves the record alone", async () => {
	const store = createMemoryStore();
	await store.create("w", snap(1));

	const value = await store.commit("w", (snapshot) => {
		snapshot.nextSeq = 99; // 即使就地改坏了，只要不写回就不影响已存的那份
		return { value: "kept" };
	});

	assert.equal(value, "kept");
	assert.equal((await store.load("w"))?.nextSeq, 1);
});

test("callers cannot reach into the stored snapshot", async () => {
	const store = createMemoryStore();
	const input = snap(1);
	await store.create("w", input);
	input.nextSeq = 99;
	const loaded = await store.load("w");
	assert.equal(loaded?.nextSeq, 1);
	loaded!.nextSeq = 42;
	assert.equal((await store.load("w"))?.nextSeq, 1);
});
