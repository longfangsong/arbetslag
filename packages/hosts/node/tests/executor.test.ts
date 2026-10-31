import assert from "node:assert/strict";
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
	resume,
	run,
} from "@arbetslag/kernel";
import { MissingPerformer, type Performer, type Performers, driveWorkflow, performInFlight } from "../src/executor.ts";

// 与内核的 `jsonSchema` 一致：zod 的 `JSONType` 与 type-fest 的 `JsonValue` 不是同一个类型。
const anyJson: z.ZodType<JsonValue> = z.json();

/** 收到 `go` 交出一个 `fake.call` 效果；收到回执把 `result` 记进 state。 */
const caller = defineNode({
	name: "caller",
	version: 1,
	state: z.object({ results: z.array(anyJson) }).default({ results: [] }),
	config: z.null(),
	ports: () => ({ out: anyJson }),
	step: ({ state, message }) => {
		switch (message.type) {
			case "go":
				return { state, effects: [{ kind: "fake.call", input: { x: 1 }, correlationId: "c1" }] };
			case "@effect.end": {
				const body = message.body as { result: JsonValue };
				return { state: { results: [...state.results, body.result] } };
			}
			default:
				return { state };
		}
	},
});

/** 收到 `go` 交出一个 `graph.mutate`：新加一个 `spawned` 节点并接到自己的 `out` 上。 */
const mutator = defineNode({
	name: "mutator",
	version: 1,
	state: z.object({ receipts: z.array(anyJson) }).default({ receipts: [] }),
	config: z.null(),
	ports: () => ({ out: anyJson }),
	step: ({ self, state, message }) => {
		switch (message.type) {
			case "go": {
				// `JsonValue` 而不是内联字面量：两个不同形状的 op 放一起会被推断成带 optional 的联合。
				const ops: JsonValue[] = [
					{ op: "spawn", id: "spawned", definition: "caller", config: null },
					{ op: "connect", from: self, to: "spawned", port: "out" },
				];
				return {
					state,
					effects: [{ kind: "graph.mutate", input: { ops }, correlationId: "m1" }],
				};
			}
			case "@effect.end": {
				const body = message.body as { result: JsonValue };
				return { state: { receipts: [...state.receipts, body.result] } };
			}
			default:
				return { state };
		}
	},
});

/** 收到任何消息都沿 `out` 原样转发，只计数。 */
const relay = defineNode({
	name: "relay",
	version: 1,
	state: z.object({ count: z.number() }).default({ count: 0 }),
	config: z.null(),
	ports: () => ({ out: anyJson }),
	step: ({ state, message }) => ({
		state: { count: state.count + 1 },
		sends: [{ port: "out", body: message.body }],
	}),
});

/** 收到 `boom` 就抛错，用来把工作流推到停住。 */
const faulty = defineNode({
	name: "faulty",
	version: 1,
	state: z.object({}).default({}),
	config: z.null(),
	ports: () => ({ out: anyJson }),
	step: ({ state, message }) => {
		if (message.type === "boom") throw new Error("boom");
		return { state };
	},
});

const registry = createRegistry({
	nodes: [caller, mutator, relay, faulty],
	effects: [{ kind: "fake.call", input: z.object({ x: z.number() }), result: anyJson }],
});

async function setup(template: WorkflowTemplate, id = "w") {
	const store = createMemoryStore();
	await createWorkflow(store, registry, template, { id });
	return { store, id };
}

const snapshot = async (store: ReturnType<typeof createMemoryStore>, id = "w") => {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new Error("missing workflow");
	return loaded;
};

/** 记下调用，按 `reply` 返回结果。 */
function spy(reply: JsonValue | (() => JsonValue) = null) {
	const calls: JsonValue[] = [];
	const performer: Performer = async (input, context) => {
		calls.push(input);
		assert.equal(context.effect.kind, "fake.call");
		return typeof reply === "function" ? reply() : reply;
	};
	return { calls, performer, performers: { "fake.call": performer } satisfies Performers };
}

test("a run produces an effect, the executor performs it, its receipt advances the graph", async () => {
	const { store, id } = await setup({ nodes: { c: { definition: "caller", config: null } } });
	await deliverToNode(store, id, "c", { type: "go", body: null });

	const { calls, performers } = spy({ ok: true, text: "hi" });
	const result = await driveWorkflow(store, registry, id, { performers });

	assert.deepEqual(result, { status: "quiescent", rounds: 2, steps: 2, settled: 1, inFlight: 0 });
	assert.deepEqual(calls, [{ x: 1 }], "the performer got the effect input");
	const s = await snapshot(store);
	assert.deepEqual(s.graph.nodeStates.c?.state, { results: [{ ok: true, text: "hi" }] });
	assert.deepEqual(s.inFlight, [], "the in-flight record is gone");
	assert.deepEqual(s.graph.nodeStates.c?.mailbox, []);
});

test("driving a quiescent workflow performs nothing", async () => {
	const { store, id } = await setup({ nodes: { c: { definition: "caller", config: null } } });
	const { calls, performers } = spy();
	const result = await driveWorkflow(store, registry, id, { performers });
	assert.deepEqual(result, { status: "quiescent", rounds: 1, steps: 0, settled: 0, inFlight: 0 });
	assert.deepEqual(calls, []);
});

test("graph.mutate is applied by the kernel's exported code, never by the performer table", async () => {
	const { store, id } = await setup({ nodes: { m: { definition: "mutator", config: null } } });
	await deliverToNode(store, id, "m", { type: "go", body: null });

	const performers: Performers = {
		"graph.mutate": () => {
			throw new Error("graph.mutate must not be handed to a performer");
		},
	};
	const result = await driveWorkflow(store, registry, id, { performers });

	assert.equal(result.status, "quiescent");
	const s = await snapshot(store);
	assert.ok(Object.hasOwn(s.graph.shape.nodes, "spawned"), "the spawned node is in the shape");
	assert.deepEqual(s.graph.nodeStates.m?.state, { receipts: [{ ok: true }] });
	assert.deepEqual(s.graph.shape.edges, [{ from: "m", to: "spawned", port: "out" }]);
});

test("an invalid graph.mutate answers with a failure receipt instead of halting", async () => {
	const { store, id } = await setup({ nodes: { m: { definition: "mutator", config: null } } });
	await deliverToNode(store, id, "m", { type: "go", body: null });
	// 先把 id 占掉，让 spawn 必然失败。
	const s = await snapshot(store);
	s.graph.shape.nodes.spawned = { definition: "caller", config: null };
	s.graph.nodeStates.spawned = { version: 1, state: { results: [] }, mailbox: [] };
	await store.commit(id, () => ({ snapshot: s, value: undefined }));

	const result = await driveWorkflow(store, registry, id, { performers: {} });
	assert.equal(result.status, "quiescent");
	const receipt = (await snapshot(store)).graph.nodeStates.m?.state as { receipts: { ok: boolean; violations: unknown[] }[] };
	assert.equal(receipt.receipts[0]?.ok, false);
	assert.deepEqual(receipt.receipts[0]?.violations, [{ code: "spawn_id_taken", id: "spawned" }]);
});

test("a halted workflow keeps its effects in flight: the executor does not touch them", async () => {
	const { store, id } = await setup({
		nodes: { c: { definition: "caller", config: null }, f: { definition: "faulty", config: null } },
	});
	await deliverToNode(store, id, "c", { type: "go", body: null }); // seq 0：交出效果
	await deliverToNode(store, id, "f", { type: "boom", body: null }); // seq 1：停住

	const { calls, performers } = spy();
	const result = await driveWorkflow(store, registry, id, { performers });

	assert.equal(result.status, "halted");
	assert.equal(result.inFlight, 1);
	assert.deepEqual(calls, [], "nothing is performed while halted");
	assert.equal((await snapshot(store)).halted?.code, "step_threw");
});

test("after resume the leftover effect is settled, then the poison message halts again", async () => {
	const { store, id } = await setup({
		nodes: { c: { definition: "caller", config: null }, f: { definition: "faulty", config: null } },
	});
	await deliverToNode(store, id, "c", { type: "go", body: null });
	await deliverToNode(store, id, "f", { type: "boom", body: null });
	const { calls, performers } = spy({ ok: true });
	await driveWorkflow(store, registry, id, { performers });
	await resume(store, id);

	const result = await driveWorkflow(store, registry, id, { performers });

	// 效果先交出去（它不依赖推进），回执进了邮箱；接着队首那条坏消息又把工作流停住。
	assert.deepEqual([result.status, result.settled, result.inFlight], ["halted", 1, 0]);
	assert.deepEqual(calls, [{ x: 1 }]);
	assert.equal((await snapshot(store)).graph.nodeStates.c?.mailbox.length, 1, "the receipt is waiting in the mailbox");
});

test("a leftover in-flight effect is settled without a new delivery, then run consumes the receipt", async () => {
	const { store, id } = await setup({ nodes: { c: { definition: "caller", config: null } } });

	// 直接造一条在飞记录：等价于“上一轮把效果交出去之后崩溃了”。
	const s = await snapshot(store);
	s.inFlight = [{ effectId: "e1", origin: "c", kind: "fake.call", input: { x: 7 } }];
	await store.commit(id, () => ({ snapshot: s, value: undefined }));

	const { performers } = spy({ ok: true });
	// 恢复扫描只需要“做效果”这一步；推进是下一次 run 的事。
	assert.deepEqual(await performInFlight(store, registry, id, performers), { settled: 1 });
	const settledSnapshot = await snapshot(store);
	assert.deepEqual(settledSnapshot.inFlight, []);
	assert.equal(settledSnapshot.graph.nodeStates.c?.mailbox.length, 1);

	const result = await driveWorkflow(store, registry, id, { performers });
	assert.equal(result.status, "quiescent");
	assert.deepEqual((await snapshot(store)).graph.nodeStates.c?.state, { results: [{ ok: true }] });
});

test("a failing performer becomes a failure result, not a halt", async () => {
	const { store, id } = await setup({ nodes: { c: { definition: "caller", config: null } } });
	await deliverToNode(store, id, "c", { type: "go", body: null });

	const result = await driveWorkflow(store, registry, id, {
		performers: {
			"fake.call": () => {
				throw new Error("kaboom");
			},
		},
	});

	assert.equal(result.status, "quiescent");
	const s = await snapshot(store);
	assert.equal(s.halted, undefined);
	assert.deepEqual(s.graph.nodeStates.c?.state, { results: [{ ok: false, error: "kaboom" }] });
});

test("a missing performer is a deployment bug: it throws and leaves the record in flight", async () => {
	const { store, id } = await setup({ nodes: { c: { definition: "caller", config: null } } });
	await deliverToNode(store, id, "c", { type: "go", body: null });

	await assert.rejects(driveWorkflow(store, registry, id, { performers: {} }), MissingPerformer);
	const s = await snapshot(store);
	assert.equal(s.inFlight.length, 1);
	assert.equal(s.graph.nodeStates.c?.mailbox.length, 0, "the message was consumed, the effect is not");
});

test("the budget only ends a run: the driver keeps going until the graph is quiescent", async () => {
	const { store, id } = await setup({
		nodes: {
			a: { definition: "relay", config: null },
			b: { definition: "relay", config: null },
			c: { definition: "relay", config: null },
		},
		edges: [
			{ from: "a", to: "b", port: "out" },
			{ from: "b", to: "c", port: "out" },
		],
	});
	await deliverToNode(store, id, "a", { type: "in", body: 1 });

	const result = await driveWorkflow(store, registry, id, { performers: {}, run: { budget: 1 } });
	assert.deepEqual(result, { status: "quiescent", rounds: 3, steps: 3, settled: 0, inFlight: 0 });
});

test("a live-locked graph stops at the host's round limit, still not halted", async () => {
	const { store, id } = await setup({
		nodes: { x: { definition: "relay", config: null }, y: { definition: "relay", config: null } },
		edges: [
			{ from: "x", to: "y", port: "out" },
			{ from: "y", to: "x", port: "out" },
		],
	});
	await deliverToNode(store, id, "x", { type: "in", body: null });

	const result = await driveWorkflow(store, registry, id, { performers: {}, maxRounds: 5, run: { budget: 2 } });
	assert.deepEqual([result.status, result.rounds], ["rounds", 5]);
	assert.equal((await snapshot(store)).halted, undefined);
});

test("effects of one round run concurrently, their receipts each land once", async () => {
	const { store, id } = await setup({
		nodes: { c: { definition: "caller", config: null } },
	});
	// 一条消息只能交给一个效果；这里直接造两条在飞记录（等价于恢复扫描看到两份）。
	const s = await snapshot(store);
	s.inFlight = [
		{ effectId: "e1", origin: "c", kind: "fake.call", input: { x: 1 } },
		{ effectId: "e2", origin: "c", kind: "fake.call", input: { x: 2 } },
	];
	await store.commit(id, () => ({ snapshot: s, value: undefined }));

	let running = 0;
	let peak = 0;
	const performers: Performers = {
		"fake.call": async () => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running--;
			return null;
		},
	};
	const result = await driveWorkflow(store, registry, id, { performers });

	assert.equal(result.settled, 2);
	assert.equal(peak, 2, "both performers were awaiting at the same time");
	const after = await snapshot(store);
	assert.deepEqual(after.inFlight, []);
	assert.deepEqual(after.graph.nodeStates.c?.state, { results: [null, null] }, "two receipts, no duplicates");
});

test("performInFlight on a halted workflow does nothing", async () => {
	const { store, id } = await setup({ nodes: { f: { definition: "faulty", config: null } } });
	await deliverToNode(store, id, "f", { type: "boom", body: null });
	await run(store, registry, id);
	assert.equal((await snapshot(store)).halted?.code, "step_threw");

	const { calls, performers } = spy();
	assert.deepEqual(await performInFlight(store, registry, id, performers), { settled: 0 });
	assert.deepEqual(calls, []);
});
