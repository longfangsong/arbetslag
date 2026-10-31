import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import {
	type Snapshot,
	type SnapshotStore,
	WorkflowExists,
	WorkflowNotFound,
	createRegistry,
	createWorkflow,
	defineNode,
} from "@arbetslag/kernel";
import { createSqliteStore } from "../src/sqliteStore.ts";

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

async function tempFile(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "arbetslag-sqlite-"));
	return join(dir, "snapshots.db");
}

/** 一次推进：把节点 a 的计数器加一。和 `step` 做的事一样，但不需要整张图跑起来。 */
function bump(store: SnapshotStore, id: string): Promise<void> {
	return store.commit(id, (snapshot) => {
		const node = snapshot.graph.nodeStates.a;
		if (node === undefined) throw new Error("missing node a");
		const next: Snapshot = {
			...snapshot,
			graph: {
				...snapshot.graph,
				nodeStates: { ...snapshot.graph.nodeStates, a: { ...node, state: { n: (node.state as { n: number }).n + 1 } } },
			},
		};
		return { snapshot: next, value: undefined };
	});
}

async function counterOf(store: SnapshotStore, id: string): Promise<number> {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new Error("missing workflow");
	return (loaded.graph.nodeStates.a?.state as { n: number }).n;
}

test("a saved snapshot is readable by a fresh store on the same file", async () => {
	const file = await tempFile();
	const store = createSqliteStore({ file });
	const { id } = await createWorkflow(store, registry, template, { id: "w1" });

	const reopened = createSqliteStore({ file });
	const loaded = await reopened.load(id);
	assert.ok(loaded !== undefined, "a new process sees the row");
	assert.deepEqual(Object.keys(loaded.graph.shape.nodes), ["a"]);

	store.close();
	reopened.close();
});

test("an empty store loads nothing and lists nothing", async () => {
	const store = createSqliteStore({ file: await tempFile() });
	assert.equal(await store.load("nope"), undefined);
	assert.deepEqual(await store.ids(), []);
	store.close();
});

test("creating an existing id is refused, and the record is left alone", async () => {
	const store = createSqliteStore({ file: await tempFile() });
	const { id } = await createWorkflow(store, registry, template, { id: "w" });
	await bump(store, id);

	await assert.rejects(
		createWorkflow(store, registry, template, { id }),
		(error: unknown) => error instanceof WorkflowExists,
	);
	assert.equal(await counterOf(store, id), 1, "the first row is untouched");
	store.close();
});

test("commit writes back what the change returns, and a change may write nothing", async () => {
	const store = createSqliteStore({ file: await tempFile() });
	const { id } = await createWorkflow(store, registry, template, { id: "w" });

	const value = await store.commit(id, (snapshot) => ({ snapshot: { ...snapshot, nextSeq: 7 }, value: "written" }));
	assert.equal(value, "written");
	assert.equal((await store.load(id))?.nextSeq, 7);

	const kept = await store.commit(id, (snapshot) => ({ snapshot: undefined, value: snapshot.nextSeq }));
	assert.equal(kept, 7, "a change that writes nothing still sees the current snapshot");
	store.close();
});

test("commit on a missing id is `WorkflowNotFound`, and a throwing change writes nothing", async () => {
	const store = createSqliteStore({ file: await tempFile() });
	await assert.rejects(
		store.commit("nope", (snapshot) => ({ snapshot, value: undefined })),
		(error: unknown) => error instanceof WorkflowNotFound,
	);

	const { id } = await createWorkflow(store, registry, template, { id: "w" });
	await assert.rejects(
		store.commit(id, () => {
			throw new Error("boom");
		}),
		/boom/,
	);
	assert.equal(await counterOf(store, id), 0, "the transaction rolled back");
	store.close();
});

test("drop removes the row and is idempotent", async () => {
	const store = createSqliteStore({ file: await tempFile() });
	const { id } = await createWorkflow(store, registry, template, { id: "w" });

	await store.drop(id);
	assert.equal(await store.load(id), undefined);
	await store.drop(id);
	assert.deepEqual(await store.ids(), []);
	store.close();
});

test("an id is a primary key, not a path", async () => {
	const store = createSqliteStore({ file: await tempFile() });
	const weird = "../telegram:123/会话 #1";
	await createWorkflow(store, registry, template, { id: weird });

	assert.ok((await store.load(weird)) !== undefined, "separators in an id are just characters");
	assert.deepEqual(await store.ids(), [weird]);
	store.close();
});

test("ids are sorted, and a dropped id disappears", async () => {
	const store = createSqliteStore({ file: await tempFile() });
	for (const id of ["c", "a", "b"]) await createWorkflow(store, registry, template, { id });
	await store.drop("b");

	assert.deepEqual(await store.ids(), ["a", "c"]);
	store.close();
});

test("two connections on one file both land: the second reads what the first wrote", async () => {
	const file = await tempFile();
	const first = createSqliteStore({ file });
	const second = createSqliteStore({ file });
	const { id } = await createWorkflow(first, registry, template, { id: "w" });

	await Promise.all([bump(first, id), bump(second, id)]);
	assert.equal(await counterOf(first, id), 2, "neither increment was thrown away");

	first.close();
	second.close();
});

test("two OS threads bumping the same row lose nothing", async () => {
	const file = await tempFile();
	const store = createSqliteStore({ file });
	const { id } = await createWorkflow(store, registry, template, { id: "w" });

	const times = 40;
	const worker = new Worker(BUMPER, { eval: true, workerData: { file, id, times } });
	const done = new Promise((resolve, reject) => {
		worker.once("message", resolve);
		worker.once("error", reject);
	});

	for (let i = 0; i < times; i++) await bump(store, id);
	await done;

	assert.equal(await counterOf(store, id), times * 2, "the write lock serialised both writers");
	store.close();
});

/** 另一个线程里的写者：只碰原始的 JSON，不依赖内核（`eval` 的 worker 解析不到 workspace 包）。 */
const BUMPER = `
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(workerData.file);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");
const select = db.prepare("SELECT snapshot FROM snapshots WHERE id = ?");
const update = db.prepare("UPDATE snapshots SET snapshot = ? WHERE id = ?");
for (let i = 0; i < workerData.times; i++) {
	db.exec("BEGIN IMMEDIATE");
	const snapshot = JSON.parse(select.get(workerData.id).snapshot);
	snapshot.graph.nodeStates.a.state.n += 1;
	update.run(JSON.stringify(snapshot), workerData.id);
	db.exec("COMMIT");
}
db.close();
parentPort.postMessage("done");
`;

test("dump is a consistent copy and does not follow later writes", async () => {
	const file = await tempFile();
	const store = createSqliteStore({ file });
	const { id } = await createWorkflow(store, registry, template, { id: "w" });
	await bump(store, id);

	const dump = await tempFile();
	await store.dumpTo(dump);

	const restored = createSqliteStore({ file: dump });
	assert.equal(await counterOf(restored, id), 1);
	assert.deepEqual(await restored.ids(), await store.ids());

	await bump(store, id);
	assert.equal(await counterOf(restored, id), 1, "the dump stays where it was");
	assert.equal(await counterOf(store, id), 2);

	store.close();
	restored.close();
});

test("dumping onto an existing database replaces it", async () => {
	const store = createSqliteStore({ file: await tempFile() });
	await createWorkflow(store, registry, template, { id: "kept" });

	const dump = await tempFile();
	const stale = createSqliteStore({ file: dump });
	await createWorkflow(stale, registry, template, { id: "gone" });
	stale.close();

	await store.dumpTo(dump);
	const restored = createSqliteStore({ file: dump });
	assert.deepEqual(await restored.ids(), ["kept"]);

	store.close();
	restored.close();
});

test("a clean close leaves one self-contained file", async () => {
	const file = await tempFile();
	const store = createSqliteStore({ file });
	await createWorkflow(store, registry, template, { id: "w" });
	store.close();
	store.close(); // 可重复

	assert.deepEqual(await readdir(dirname(file)), ["snapshots.db"], "no -wal / -shm left behind");
});

test("a damaged row fails loudly on load instead of advancing a broken graph", async () => {
	const file = await tempFile();
	const store = createSqliteStore({ file });
	await createWorkflow(store, registry, template, { id: "good" });

	// 「有人拿 sqlite3 手改过 / 写坏了」：读出来就该响亮地坏掉。
	const raw = new DatabaseSync(file);
	raw.prepare("INSERT INTO snapshots (id, snapshot) VALUES (?, ?)").run("bad", "{ this is not json");
	raw.close();

	await assert.rejects(store.load("bad"), SyntaxError);
	assert.ok((await store.load("good")) !== undefined, "the healthy row is unaffected");
	store.close();
});
