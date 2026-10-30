import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverFromTrigger, deliverToNode, run } from "../../src/run/index.ts";
import type { WorkflowTemplate } from "../../src/workflow/template/index.ts";
import { load, registry, setup } from "./fixtures.ts";

/** 一个出口接三个订阅者。边故意按 d、b、c 书写：投递序不该跟着书写顺序走（ADR-0012）。 */
const fanOut: WorkflowTemplate = {
	nodes: {
		src: { definition: "relay", config: null },
		b: { definition: "relay", config: null },
		c: { definition: "relay", config: null },
		d: { definition: "relay", config: null },
	},
	edges: [
		{ from: "src", to: "d", port: "out" },
		{ from: "src", to: "b", port: "out" },
		{ from: "src", to: "c", port: "out" },
	],
};

const transitions = (entries: readonly { type: string }[] | undefined) =>
	(entries ?? []).filter((e) => e.type === "transition") as unknown as {
		node: string;
		seq: number;
		sends: number;
		delivered: number;
	}[];

test("one send reaches every subscriber; seq follows target id order (ADR-0011)", async () => {
	const { store, log, id } = await setup(fanOut);
	await deliverToNode(store, id, "src", { type: "in", body: "hi" });
	await run(store, registry, id, { log });

	const first = transitions(log.entries.get(id))[0];
	assert.deepEqual([first?.sends, first?.delivered], [1, 3]);
	assert.deepEqual(
		transitions(log.entries.get(id)).map((e) => e.node),
		["src", "b", "c", "d"],
	);

	const s = await load(store);
	assert.deepEqual(
		["b", "c", "d"].map((n) => s.graph.nodeStates[n]?.state),
		[{ count: 1 }, { count: 1 }, { count: 1 }],
	);
	assert.equal(s.nextSeq, 4); // 投递 1 + 扇出 3
});

test("a fan-out is one commit: if the snapshot blows up, none of the copies land", async () => {
	const { store, id } = await setup(fanOut);
	await deliverToNode(store, id, "src", { type: "in", body: "x".repeat(500) });
	const result = await run(store, registry, id, { maxSnapshotBytes: 900 });
	assert.equal(result.status, "halted");

	const s = await load(store);
	assert.equal(s.halted?.code, "snapshot_too_large");
	assert.equal(s.graph.nodeStates.src?.mailbox.length, 1); // 触发它的那条仍在队首
	assert.deepEqual(s.graph.nodeStates.src?.state, { count: 0 }); // 转移整条没应用
	assert.deepEqual(
		["b", "c", "d"].map((n) => s.graph.nodeStates[n]?.mailbox.length),
		[0, 0, 0],
	);
});

test("an explicit target is addressing: exactly one, and the edges are ignored", async () => {
	const { store, id } = await setup({
		nodes: {
			f: { definition: "faulty", config: null },
			r: { definition: "relay", config: null },
			other: { definition: "relay", config: null },
		},
		// f.out 有一个订阅者，但 `direct` 显式指定了目标：只有它收到
		edges: [{ from: "f", to: "other", port: "out" }],
	});
	await deliverToNode(store, id, "f", { type: "direct", body: "r" });
	await run(store, registry, id);

	const s = await load(store);
	assert.deepEqual(s.graph.nodeStates.r?.state, { count: 1 });
	assert.deepEqual(s.graph.nodeStates.other?.state, { count: 0 });
});

test("a trigger output with several subscribers reaches all of them, in target id order", async () => {
	const { store, id } = await setup({
		nodes: {
			a: { definition: "relay", config: null },
			b: { definition: "relay", config: null },
		},
		edges: [
			{ from: "t", to: "b", port: "text" },
			{ from: "t", to: "a", port: "text" },
		],
		triggers: [{ id: "t", kind: "hook", config: {} }],
	});
	assert.equal(await deliverFromTrigger(store, registry, id, "t", "text", "hello"), true);

	const s = await load(store);
	assert.deepEqual(s.graph.nodeStates.a?.mailbox, [{ seq: 0, message: { type: "text", body: "hello" } }]);
	assert.deepEqual(s.graph.nodeStates.b?.mailbox, [{ seq: 1, message: { type: "text", body: "hello" } }]);
	assert.equal(s.nextSeq, 2);
});

test("a port with no subscriber is still dropped, and logged once per send", async () => {
	const { store, log, id } = await setup(fanOut);
	await deliverToNode(store, id, "b", { type: "in", body: 1 }); // b.out 没人订阅
	await run(store, registry, id, { log });

	const dropped = (log.entries.get(id) ?? []).filter((e) => e.type === "dropped");
	assert.equal(dropped.length, 1);
	assert.equal((await load(store)).halted, undefined);
});
