import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import {
	type TransitionLog,
	type WorkflowTemplate,
	createMemoryStore,
	createRegistry,
	createWorkflow,
	defineNode,
} from "@arbetslag/kernel";
import type { Performers } from "../src/executor.ts";
import type { TriggerRuntime } from "../src/triggers/runtime.ts";
import { createHost, drive, submit, submitFromTrigger } from "../src/host.ts";

const anyJson: z.ZodType<JsonValue> = z.json();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 收到 `go` 交出一个 `slow.call`；收到回执把回执记进 state。 */
const worker = defineNode({
	name: "worker",
	version: 1,
	state: z.object({ done: z.array(anyJson) }).default({ done: [] }),
	config: z.null(),
	ports: () => ({ out: anyJson }),
	step: ({ state, message }) => {
		switch (message.type) {
			case "go":
				return {
					state,
					effects: [
						{ kind: "slow.call", input: message.body, correlationId: `c${String(state.done.length)}` },
					],
				};
			case "@effect.end":
				return { state: { done: [...state.done, message.body] } };
			case "stop": {
				const ops: JsonValue[] = [{ op: "removeTrigger", id: "hook" }];
				return { state, effects: [{ kind: "graph.mutate", input: { ops }, correlationId: "m1" }] };
			}
			default:
				return { state };
		}
	},
});

/** 只记录，什么都不做。 */
const sink = defineNode({
	name: "sink",
	version: 1,
	state: z.object({ got: z.array(anyJson) }).default({ got: [] }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => ({ state: { got: [...state.got, message.body] } }),
});

const registry = createRegistry({
	nodes: [worker, sink],
	effects: [{ kind: "slow.call", input: anyJson, result: anyJson }],
	triggers: [{ kind: "webhook", config: z.object({}), outputs: () => ({ ping: anyJson }) }],
});

/** 记下并发峰值，好断言「同一份工作流的投递不交错」。 */
function spy() {
	const calls: JsonValue[] = [];
	let running = 0;
	let peak = 0;
	const performers: Performers = {
		"slow.call": async (input) => {
			calls.push(input);
			running++;
			peak = Math.max(peak, running);
			await tick();
			running--;
			return { ok: true };
		},
	};
	return { calls, performers, peak: () => peak };
}

function recordingLog() {
	const entries: string[] = [];
	const log: TransitionLog = {
		append: (_id, batch) => {
			for (const entry of batch) entries.push(entry.type);
		},
	};
	return { entries, log };
}

async function setup(template: WorkflowTemplate, id = "w") {
	const store = createMemoryStore();
	await createWorkflow(store, registry, template, { id });
	return store;
}

const stateOf = async (store: ReturnType<typeof createMemoryStore>, node: string, id = "w") => {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new Error("missing workflow");
	return loaded.snapshot.graph.nodeStates[node]?.state;
};

const oneWorker: WorkflowTemplate = { nodes: { w: { definition: "worker", config: null } } };

test("submit delivers and drives to quiescent in one call", async () => {
	const store = await setup(oneWorker);
	const host = createHost({ store, registry, performers: spy().performers });

	const result = await submit(host, "w", "w", { type: "go", body: { n: 1 } });

	assert.deepEqual(result, { status: "quiescent", rounds: 2, steps: 2, settled: 1, inFlight: 0 });
	assert.deepEqual(await stateOf(store, "w"), { done: [{ correlationId: "c0", result: { ok: true } }] });
});

test("concurrent submits on one workflow are serialized, not interleaved", async () => {
	const store = await setup(oneWorker);
	const { performers, peak } = spy();
	const host = createHost({ store, registry, performers });

	const results = await Promise.all([
		submit(host, "w", "w", { type: "go", body: { n: 1 } }),
		submit(host, "w", "w", { type: "go", body: { n: 2 } }),
	]);

	assert.equal(peak(), 1, "the second submit started before the first finished driving");
	for (const result of results) assert.equal(result.settled, 1, "each submit settled its own effect");
	const done = (await stateOf(store, "w")) as { done: JsonValue[] };
	assert.equal(done.done.length, 2);
});

test("submits to different workflows run in parallel", async () => {
	const store = createMemoryStore();
	await createWorkflow(store, registry, oneWorker, { id: "a" });
	await createWorkflow(store, registry, oneWorker, { id: "b" });
	const { performers, peak } = spy();
	const host = createHost({ store, registry, performers });

	await Promise.all([
		submit(host, "a", "w", { type: "go", body: { n: 1 } }),
		submit(host, "b", "w", { type: "go", body: { n: 2 } }),
	]);

	assert.equal(peak(), 2, "different workflows waited for each other");
});

test("drive on a quiescent workflow performs nothing and does not fail", async () => {
	const store = await setup(oneWorker);
	const { performers, calls } = spy();
	const host = createHost({ store, registry, performers });

	assert.deepEqual(await drive(host, "w"), {
		status: "quiescent",
		rounds: 1,
		steps: 0,
		settled: 0,
		inFlight: 0,
	});
	assert.deepEqual(calls, []);
});

test("submitFromTrigger drops an output nobody subscribed to", async () => {
	const store = await setup({ nodes: { s: { definition: "sink", config: null } }, triggers: [{ id: "hook", kind: "webhook", config: {} }] });
	const { performers } = spy();
	const { entries, log } = recordingLog();
	const host = createHost({ store, registry, performers, log });

	const result = await submitFromTrigger(host, "w", "hook", "ping", { n: 1 });

	assert.equal(result, undefined, "nothing was delivered");
	assert.deepEqual(entries, ["dropped"]);
	assert.deepEqual(await stateOf(store, "s"), { got: [] });
});

test("submitFromTrigger delivers along the edge and drives", async () => {
	const store = await setup({
		nodes: { s: { definition: "sink", config: null } },
		triggers: [{ id: "hook", kind: "webhook", config: {} }],
		edges: [{ from: "hook", to: "s", port: "ping" }],
	});
	const { performers } = spy();
	const host = createHost({ store, registry, performers });

	const result = await submitFromTrigger(host, "w", "hook", "ping", { n: 1 });

	assert.equal(result?.status, "quiescent");
	assert.deepEqual(await stateOf(store, "s"), { got: [{ n: 1 }] });
});

// ── 触发器接线：宿主每次推完都对账（ADR-0001） ──────────────────────────────

const fakeRuntime = (events: string[]): TriggerRuntime => ({
	kind: "webhook",
	async open(declaration) {
		events.push(`open ${declaration.id}`);
		return {
			close: async () => {
				events.push(`close ${declaration.id}`);
			},
		};
	},
});

const wired: WorkflowTemplate = {
	nodes: { w: { definition: "worker", config: null }, s: { definition: "sink", config: null } },
	triggers: [{ id: "hook", kind: "webhook", config: {} }],
	edges: [{ from: "hook", to: "s", port: "ping" }],
};

test("the host opens declared triggers after a drive, without anyone asking", async () => {
	const store = await setup(wired);
	const events: string[] = [];
	const host = createHost({
		store,
		registry,
		performers: spy().performers,
		triggers: { runtimes: { webhook: fakeRuntime(events) } },
	});

	assert.deepEqual(host.triggers?.running("w"), [], "nothing is running before the first drive");
	await submit(host, "w", "w", { type: "go", body: { n: 1 } });

	assert.deepEqual(host.triggers?.running("w"), ["hook"]);
	assert.deepEqual(events, ["open hook"]);
	await host.triggers?.stop();
});

test("a graph.mutate that removes a trigger closes its listener in the same turn", async () => {
	const store = await setup(wired);
	const events: string[] = [];
	const host = createHost({
		store,
		registry,
		performers: spy().performers,
		triggers: { runtimes: { webhook: fakeRuntime(events) } },
	});

	await submit(host, "w", "w", { type: "go", body: { n: 1 } });
	await submit(host, "w", "w", { type: "stop", body: null });

	assert.deepEqual(host.triggers?.running("w"), []);
	assert.deepEqual(events, ["open hook", "close hook"]);
	await host.triggers?.stop();
});

test("a host without a trigger configuration has no triggers at all", async () => {
	const store = await setup(oneWorker);
	const host = createHost({ store, registry, performers: spy().performers });
	assert.equal(host.triggers, undefined);
});
