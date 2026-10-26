import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import {
	Conflict,
	createRegistry,
	createWorkflow,
	defineNode,
} from "@arbetslag/kernel";
import { createFsStore } from "../src/fsStore.ts";
import { createFsIndex, createMemoryIndex } from "../src/workflowIndex.ts";

const counter = defineNode({
	name: "counter",
	version: 1,
	state: z.object({ n: z.number() }).default({ n: 0 }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state }) => ({ state: { n: state.n + 1 } }),
});

const registry = createRegistry({ nodes: [counter], effects: [] });
const template = { nodes: { a: { definition: "counter", config: null } } };

async function tempDir() {
	return mkdtemp(join(tmpdir(), "arbetslag-store-"));
}

test("a saved snapshot is readable by a fresh store instance on the same directory", async () => {
	const dir = await tempDir();
	const store = createFsStore({ dir });
	const { id, revision } = await createWorkflow(store, registry, template, { id: "w1" });

	const reopened = createFsStore({ dir });
	const loaded = await reopened.load(id);
	assert.ok(loaded !== undefined, "a new process sees the file");
	assert.equal(loaded.revision, revision);
	assert.deepEqual(Object.keys(loaded.snapshot.graph.shape.nodes), ["a"]);
});

test("load of an unknown id is undefined, not an error", async () => {
	const store = createFsStore({ dir: await tempDir() });
	assert.equal(await store.load("nope"), undefined);
});

test("creating an existing id conflicts, and the record is left alone", async () => {
	const store = createFsStore({ dir: await tempDir() });
	const { id } = await createWorkflow(store, registry, template, { id: "w" });

	await assert.rejects(
		createWorkflow(store, registry, template, { id }),
		(error: unknown) => error instanceof Conflict && error.reason === "exists",
	);
	assert.ok((await store.load(id)) !== undefined);
});

test("save with a stale or missing revision conflicts", async () => {
	const store = createFsStore({ dir: await tempDir() });
	const { id, revision } = await createWorkflow(store, registry, template, { id: "w" });
	const loaded = await store.load(id);
	if (loaded === undefined) throw new Error("missing workflow");

	await assert.rejects(
		store.save(id, loaded.snapshot, "not-the-revision"),
		(error: unknown) => error instanceof Conflict && error.reason === "stale",
	);

	const next = await store.save(id, loaded.snapshot, revision);
	await store.drop(id);
	await assert.rejects(
		store.save(id, loaded.snapshot, next),
		(error: unknown) => error instanceof Conflict && error.reason === "missing",
	);
});

test("drop removes the record and is idempotent", async () => {
	const dir = await tempDir();
	const store = createFsStore({ dir });
	const { id } = await createWorkflow(store, registry, template, { id: "w" });

	await store.drop(id);
	assert.equal(await store.load(id), undefined);
	await store.drop(id);
	assert.deepEqual(await createFsIndex({ dir }).ids(), []);
});

test("ids survive being used as file names", async () => {
	const dir = await tempDir();
	const store = createFsStore({ dir });
	const weird = "../telegram:123/会话 #1";
	await createWorkflow(store, registry, template, { id: weird });

	const loaded = await store.load(weird);
	assert.ok(loaded !== undefined, "an id with separators is not a path");
	assert.deepEqual(await createFsIndex({ dir }).ids(), [weird]);
});

test("the fs index lists snapshots only, sorted, and ignores stray files", async () => {
	const dir = await tempDir();
	const store = createFsStore({ dir });
	for (const id of ["b", "a"]) await createWorkflow(store, registry, template, { id });
	await writeFile(join(dir, "notes.txt"), "hello", "utf8");
	await writeFile(join(dir, "leftover.json.1234.tmp"), "{}", "utf8");

	assert.deepEqual(await createFsIndex({ dir }).ids(), ["a", "b"]);
	assert.deepEqual(
		await createFsIndex({ dir: join(dir, "does-not-exist") }).ids(),
		[],
		"a missing directory is an empty index, not an error",
	);
});

test("the memory index reads the array it was given, every time", async () => {
	const ids = ["a"];
	const index = createMemoryIndex(ids);
	assert.deepEqual(await index.ids(), ["a"]);
	ids.push("b");
	assert.deepEqual(await index.ids(), ["a", "b"]);
});
