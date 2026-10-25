import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createMemoryStore } from "../../src/memoryStore.ts";
import { defineNode } from "../../src/nodeDefinition.ts";
import { createRegistry } from "../../src/registry.ts";
import { deliverToNode, run } from "../../src/run/index.ts";
import { createMemoryLog } from "../../src/transitionLog.ts";
import { createWorkflow } from "../../src/workflow/template/index.ts";
import type { Snapshot } from "../../src/workflow/snapshot.ts";

const versioned = (version: number, migrate?: (state: unknown, from: number) => never) =>
	defineNode({
		name: "doc",
		version,
		state: z.object({ text: z.string(), words: z.number().default(0) }).default({ text: "", words: 0 }),
		config: z.null(),
		ports: () => ({}),
		step: ({ state }) => ({ state }),
		...(migrate === undefined ? {} : { migrate }),
	});

/** 用 v1 写下一份快照，之后换成别的定义再 run。 */
async function written(afterwards: ReturnType<typeof versioned>, patch?: (s: Snapshot) => void) {
	const store = createMemoryStore();
	const v1 = createRegistry({ nodes: [versioned(1)] });
	await createWorkflow(store, v1, { nodes: { d: { definition: "doc", config: null, state: { text: "hi" } } } }, { id: "w" });
	await deliverToNode(store, "w", "d", { type: "x", body: null });
	if (patch) {
		const loaded = await store.load("w");
		patch(loaded!.snapshot);
		await store.save("w", loaded!.snapshot, loaded!.revision);
	}
	return { store, registry: createRegistry({ nodes: [afterwards] }) };
}

test("a state written by an older version is migrated forward on load, and saved", async () => {
	const log = createMemoryLog();
	const v2 = versioned(2, (old) => ({ ...(old as object), words: 1 }) as never);
	const { store, registry } = await written(v2);
	const result = await run(store, registry, "w", { log });
	assert.equal(result.status, "quiescent");

	const d = (await store.load("w"))?.snapshot.graph.nodeStates.d;
	assert.deepEqual([d?.version, d?.state], [2, { text: "hi", words: 1 }]);
	assert.deepEqual(log.entries.get("w")?.filter((e) => e.type === "migrated").map((e) => (e as { from: number }).from), [1]);
});

test("without a migrate function the old state is kept if it still fits the schema", async () => {
	const { store, registry } = await written(versioned(2));
	await run(store, registry, "w");
	const d = (await store.load("w"))?.snapshot.graph.nodeStates.d;
	assert.deepEqual([d?.version, d?.state], [2, { text: "hi", words: 0 }]);
});

test("a failing migration halts and leaves the snapshot exactly as it was", async () => {
	const boom = versioned(2, () => {
		throw new Error("cannot migrate");
	});
	const { store, registry } = await written(boom);
	const before = (await store.load("w"))?.snapshot;
	await run(store, registry, "w");
	const after = (await store.load("w"))?.snapshot;
	assert.equal(after?.halted?.code, "migration_failed");
	assert.deepEqual({ ...after, halted: undefined }, { ...before, halted: undefined });
	assert.equal(after?.graph.nodeStates.d?.version, 1);
});

test("a migration whose output does not fit the schema halts as migration_failed", async () => {
	const bad = versioned(2, () => ({ text: 5 }) as never);
	const { store, registry } = await written(bad);
	await run(store, registry, "w");
	assert.equal((await store.load("w"))?.snapshot.halted?.code, "migration_failed");
});

test("a state newer than the deployed definition halts: no guessing at newer data", async () => {
	const { store, registry } = await written(versioned(1), (s) => {
		s.graph.nodeStates.d!.version = 5;
	});
	await run(store, registry, "w");
	assert.equal((await store.load("w"))?.snapshot.halted?.code, "version_ahead");
});

test("an unknown definition, an invalid config and an invalid state all halt on load", async () => {
	const unknown = await written(versioned(1), (s) => {
		s.graph.shape.nodes.d!.definition = "ghost";
	});
	await run(unknown.store, unknown.registry, "w");
	assert.equal((await unknown.store.load("w"))?.snapshot.halted?.code, "definition_unknown");

	const config = await written(versioned(1), (s) => {
		s.graph.shape.nodes.d!.config = { not: "null" };
	});
	await run(config.store, config.registry, "w");
	assert.equal((await config.store.load("w"))?.snapshot.halted?.code, "config_invalid");

	const state = await written(versioned(1), (s) => {
		s.graph.nodeStates.d!.state = { text: 1 };
	});
	await run(state.store, state.registry, "w");
	assert.equal((await state.store.load("w"))?.snapshot.halted?.code, "state_invalid");
});

test("a corrupted snapshot halts as graph_invalid", async () => {
	const { store, registry } = await written(versioned(1), (s) => {
		s.graph.shape.edges.push({ from: "d", to: "ghost", port: "p" });
	});
	await run(store, registry, "w");
	assert.equal((await store.load("w"))?.snapshot.halted?.code, "graph_invalid");
});
