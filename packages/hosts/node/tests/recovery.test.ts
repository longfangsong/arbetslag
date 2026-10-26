import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import {
	type WorkflowTemplate,
	createMemoryStore,
	createRegistry,
	createWorkflow,
	defineNode,
	deliverToNode,
	run,
} from "@arbetslag/kernel";
import { MissingPerformer, type Performers } from "../src/executor.ts";
import { snapshotFile } from "../src/fsStore.ts";
import { createHost } from "../src/host.ts";
import { recover } from "../src/recovery.ts";
import { createMemoryIndex, createFsIndex } from "../src/workflowIndex.ts";
import { createFsStore } from "../src/fsStore.ts";

const anyJson: z.ZodType<JsonValue> = z.json();

/** 收到 `go` 交出一个 `slow.call`；收到回执把它记进 state。 */
const worker = defineNode({
	name: "worker",
	version: 1,
	state: z.object({ done: z.array(anyJson) }).default({ done: [] }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type === "go") {
			return { state, effects: [{ kind: "slow.call", input: message.body, correlationId: "c" }] };
		}
		if (message.type === "@effect.end") return { state: { done: [...state.done, message.body] } };
		return { state };
	},
});

/** 收到 `boom` 就抛错 → 停住。 */
const faulty = defineNode({
	name: "faulty",
	version: 1,
	state: z.object({}).default({}),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type === "boom") throw new Error("boom");
		return { state };
	},
});

const registry = createRegistry({
	nodes: [worker, faulty],
	effects: [{ kind: "slow.call", input: anyJson, result: anyJson }],
});

const workerTemplate: WorkflowTemplate = { nodes: { w: { definition: "worker", config: null } } };
const faultyTemplate: WorkflowTemplate = { nodes: { f: { definition: "faulty", config: null } } };

function spy() {
	const calls: JsonValue[] = [];
	const performers: Performers = {
		"slow.call": async (input) => {
			calls.push(input);
			return { ok: true };
		},
	};
	return { calls, performers };
}

test("each workflow lands in exactly one bucket, and the ones with work get advanced", async () => {
	const store = createMemoryStore();
	const ids: string[] = [];
	const index = createMemoryIndex(ids);
	const { performers, calls } = spy();
	const host = createHost({ store, registry, performers });

	// 静止：什么都不用做。
	await createWorkflow(store, registry, workerTemplate, { id: "quiet" });
	ids.push("quiet");
	// 悬挂态：投递成功、Run 没跑（ADR-0003 推荐的串行入口要能捡起它）。
	await createWorkflow(store, registry, workerTemplate, { id: "hanging" });
	ids.push("hanging");
	await deliverToNode(store, "hanging", "w", { type: "go", body: { n: 2 } });
	// 在飞效果：Run 出过图，回执还没回来。
	await createWorkflow(store, registry, workerTemplate, { id: "effect" });
	ids.push("effect");
	await deliverToNode(store, "effect", "w", { type: "go", body: { n: 3 } });
	await run(store, registry, "effect");
	// 停住：扫描不动它。
	await createWorkflow(store, registry, faultyTemplate, { id: "halted" });
	ids.push("halted");
	await deliverToNode(store, "halted", "f", { type: "boom", body: null });
	await run(store, registry, "halted");
	// 过期索引：索引里有、store 里没有。
	ids.push("gone");

	const report = await recover(host, index);

	assert.equal(report.scanned, 5);
	assert.deepEqual(
		report.advanced.map((entry) => entry.id),
		["hanging", "effect"],
	);
	assert.deepEqual(report.quiescent, ["quiet"]);
	assert.deepEqual(report.halted, ["halted"]);
	assert.deepEqual(report.missing, ["gone"]);
	assert.deepEqual(report.failed, []);

	assert.deepEqual(calls, [{ n: 2 }, { n: 3 }], "both the hanging run and the leftover effect were performed");
	const recovered = await store.load("effect");
	assert.deepEqual(recovered?.snapshot.inFlight, [], "the leftover effect is settled");
	assert.deepEqual(recovered?.snapshot.graph.nodeStates.w?.state, { done: [{ correlationId: "c", result: { ok: true } }] });
});

test("a second scan finds nothing left to do", async () => {
	const store = createMemoryStore();
	const ids: string[] = [];
	const index = createMemoryIndex(ids);
	const host = createHost({ store, registry, performers: spy().performers });

	await createWorkflow(store, registry, workerTemplate, { id: "hanging" });
	ids.push("hanging");
	await deliverToNode(store, "hanging", "w", { type: "go", body: { n: 1 } });

	const first = await recover(host, index);
	assert.deepEqual(first.advanced.map((entry) => entry.id), ["hanging"]);

	const second = await recover(host, index);
	assert.deepEqual(second.quiescent, ["hanging"]);
	assert.deepEqual(second.advanced, []);
});

test("a workflow with no performer for its in-flight effect fails alone", async () => {
	const store = createMemoryStore();
	const ids: string[] = [];
	const index = createMemoryIndex(ids);
	const host = createHost({ store, registry, performers: {} });

	await createWorkflow(store, registry, workerTemplate, { id: "orphan" });
	ids.push("orphan");
	await deliverToNode(store, "orphan", "w", { type: "go", body: { n: 1 } });
	await run(store, registry, "orphan");

	await createWorkflow(store, registry, workerTemplate, { id: "fine" });
	ids.push("fine");

	const report = await recover(host, index);

	assert.equal(report.failed.length, 1);
	assert.equal(report.failed[0]?.id, "orphan");
	assert.ok(report.failed[0]?.error instanceof MissingPerformer);
	assert.deepEqual(report.quiescent, ["fine"], "one broken workflow does not stop the scan");
});

test("a corrupt snapshot on disk is reported, not thrown", async () => {
	const dir = await mkdtemp(join(tmpdir(), "arbetslag-recovery-"));
	const store = createFsStore({ dir });
	const index = createFsIndex({ dir });
	const host = createHost({ store, registry, performers: spy().performers });

	await createWorkflow(store, registry, workerTemplate, { id: "good" });
	await writeFile(snapshotFile(dir, "bad"), "{ this is not json", "utf8");

	const report = await recover(host, index);

	assert.deepEqual(report.quiescent, ["good"]);
	assert.equal(report.failed.length, 1);
	assert.equal(report.failed[0]?.id, "bad");
});
