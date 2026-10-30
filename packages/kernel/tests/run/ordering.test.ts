import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createMemoryStore } from "../../src/memoryStore.ts";
import { defineNode } from "../../src/nodeDefinition.ts";
import { createRegistry } from "../../src/registry.ts";
import { deliverToNode, run } from "../../src/run/index.ts";
import { createMemoryLog } from "../../src/transitionLog.ts";
import { createWorkflow, type WorkflowTemplate } from "../../src/workflow/template/index.ts";
import { chain, load, registry, relay, setup } from "./fixtures.ts";

/**
 * ADR-0012 的契约测试。这些断言写的是**承诺**，不是实现细节：
 * 任何改动推进内部（拷贝方式、遍历顺序、邮箱结构）的重构都必须让它们继续绿。
 */

const nodes = (entries: readonly { type: string }[] | undefined) =>
	(entries ?? []).filter((e) => e.type === "transition").map((e) => (e as unknown as { node: string }).node);

const seqs = (entries: readonly { type: string }[] | undefined) =>
	(entries ?? []).filter((e) => e.type === "transition").map((e) => (e as unknown as { seq: number }).seq);

test("each mailbox is FIFO, and the next message is the smallest seq overall", async () => {
	const { store, log, id } = await setup({
		nodes: { a: { definition: "relay", config: null }, b: { definition: "relay", config: null } },
		edges: [],
	});
	await deliverToNode(store, id, "b", { type: "in", body: 1 }); // seq 0
	await deliverToNode(store, id, "b", { type: "in", body: 2 }); // seq 1
	await deliverToNode(store, id, "a", { type: "in", body: 3 }); // seq 2
	await run(store, registry, id, { log });
	assert.deepEqual(nodes(log.entries.get(id)), ["b", "b", "a"]);
	assert.deepEqual(seqs(log.entries.get(id)), [0, 1, 2]);
});

test("a message is never processed before its cause", async () => {
	const { store, log, id } = await setup(chain);
	await deliverToNode(store, id, "a", { type: "in", body: "hi" });
	await run(store, registry, id, { log });
	// a 是 b 的因，b 是 c 的因：处理顺序与 seq 顺序一致
	assert.deepEqual(nodes(log.entries.get(id)), ["a", "b", "c"]);
	assert.deepEqual(seqs(log.entries.get(id)), [0, 1, 2]);
});

/** 两个端口各接两个订阅者；投递序应当是 (sends 下标, 目标 id) 的字典序。 */
const pair = defineNode({
	name: "pair",
	version: 1,
	state: z.object({ n: z.number() }).default({ n: 0 }),
	config: z.null(),
	ports: () => ({ p: z.json(), q: z.json() }),
	step: ({ state, message }) =>
		message.type === "go"
			? { state, sends: [{ port: "p", body: 1 }, { port: "q", body: 2 }] }
			: { state: { n: state.n + 1 } },
});

const pairRegistry = createRegistry({ nodes: [pair, relay] });

const twoPorts: WorkflowTemplate = {
	nodes: {
		src: { definition: "pair", config: null },
		z2: { definition: "relay", config: null },
		a1: { definition: "relay", config: null },
		z1: { definition: "relay", config: null },
		a2: { definition: "relay", config: null },
	},
	edges: [
		{ from: "src", to: "z2", port: "p" },
		{ from: "src", to: "a1", port: "p" },
		{ from: "src", to: "z1", port: "q" },
		{ from: "src", to: "a2", port: "q" },
	],
};

const orderOf = async (template: WorkflowTemplate): Promise<string[]> => {
	const store = createMemoryStore();
	const log = createMemoryLog();
	await createWorkflow(store, pairRegistry, template, { id: "w" });
	await deliverToNode(store, "w", "src", { type: "go", body: null });
	await run(store, pairRegistry, "w", { log });
	return nodes(log.entries.get("w"));
};

test("delivery order is (send index, target id)", async () => {
	// p 的两个目标先（a1 < z2），然后 q 的两个（a2 < z1）
	assert.deepEqual(await orderOf(twoPorts), ["src", "a1", "z2", "a2", "z1"]);
});

test("the order is a function of the snapshot, not of the edge array's order", async () => {
	const reversed: WorkflowTemplate = { ...twoPorts, edges: [...(twoPorts.edges ?? [])].reverse() };
	assert.deepEqual(await orderOf(reversed), await orderOf(twoPorts));
});

test("nextSeq carries over: two budgeted runs allocate the same seqs as one", async () => {
	const whole = await setup();
	await deliverToNode(whole.store, whole.id, "a", { type: "in", body: "hi" });
	await run(whole.store, registry, whole.id);
	const expected = (await load(whole.store)).nextSeq;

	const split = await setup();
	await deliverToNode(split.store, split.id, "a", { type: "in", body: "hi" });
	await run(split.store, registry, split.id, { budget: 1 });
	await run(split.store, registry, split.id);

	assert.equal((await load(split.store)).nextSeq, expected);
	assert.equal(expected, 3);
});
