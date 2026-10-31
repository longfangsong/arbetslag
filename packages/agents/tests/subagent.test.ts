import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import {
	type InFlightEffect,
	type Snapshot,
	type SnapshotStore,
	type WorkflowTemplate,
	completeEffect,
	createMemoryStore,
	createRegistry,
	createWorkflow,
	defineNode,
	deliverToNode,
	performGraphMutate,
	run,
} from "@arbetslag/kernel";
import {
	agent,
	conversation,
	defineSubagent,
	defineTool,
	modelCompleteKind,
	subagentFragment,
	textMessage,
	timerWaitKind,
} from "../src/index.ts";

const anyJson: z.ZodType<JsonValue> = z.json();

const clock = defineTool({
	name: "clock",
	description: "看看几点",
	input: z.object({}),
	state: z.null().default(null),
	config: z.null(),
	run: () => ({ state: null, result: { time: "12:00" } }),
});

const recorder = defineNode({
	name: "recorder",
	version: 1,
	state: z.object({ results: z.array(anyJson) }).default({ results: [] }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => ({ state: { results: [...state.results, message.body] } }),
});

const fragment = subagentFragment({
	agent: "child",
	config: { model: "fake-1" },
	tools: [{ tool: clock }],
});

const subagent = defineSubagent({
	name: "subagent",
	description: "让一个子 agent 去办",
	input: z.object({ task: z.string() }),
});

const registry = createRegistry({
	nodes: [agent, conversation, clock, recorder, subagent],
	effects: [modelCompleteKind, timerWaitKind],
});

const template: WorkflowTemplate = {
	nodes: {
		sub: { definition: "subagent", config: { fragment, timeoutMs: 1000 } },
		out: { definition: "recorder", config: null },
	},
	edges: [{ from: "sub", to: "out", port: "tool.result" }],
};

async function setup() {
	const store = createMemoryStore();
	await createWorkflow(store, registry, template, { id: "w" });
	return store;
}

const snapshot = async (store: SnapshotStore): Promise<Snapshot> => {
	const loaded = await store.load("w");
	if (loaded === undefined) throw new Error("missing workflow");
	return loaded;
};

const ofKind = (s: Snapshot, kind: string): InFlightEffect[] => s.inFlight.filter((effect) => effect.kind === kind);

/** 宿主该做的事，这里手写：改图的自己应用，其余的效果交一条结果。 */
async function settle(store: SnapshotStore, effect: InFlightEffect, result: JsonValue = null) {
	if (effect.kind === "graph.mutate") return performGraphMutate(store, registry, "w", effect.effectId);
	return completeEffect(store, "w", effect.effectId, result);
}

const answer = (text: string) => ({ ok: true, message: textMessage("assistant", text) });

const ask = (store: SnapshotStore, callId = "c1", task = "问一下子 agent") =>
	deliverToNode(store, "w", "sub", {
		type: "tool.subagent",
		body: { callId, name: "subagent", input: { task } },
	});

test("a call spawns a child agent, wires it, and sends it the task", async () => {
	const store = await setup();
	await ask(store, "c1", "算一下");
	await run(store, registry, "w");

	const spawn = ofKind(await snapshot(store), "graph.mutate");
	assert.equal(spawn.length, 1, "起子 agent 是一次改图");

	await settle(store, spawn[0] as InFlightEffect);
	await run(store, registry, "w");

	const s = await snapshot(store);
	const nodes = Object.keys(s.graph.shape.nodes);
	assert.deepEqual(nodes.sort(), [
		"out",
		"sub",
		"sub.child1",
		"sub.child1.clock",
		"sub.child1.conversation",
	]);
	assert.deepEqual(
		s.graph.shape.edges.map((edge) => `${edge.from}→${edge.to}:${edge.port}`).sort(),
		[
			"sub.child1.clock→sub.child1:tool.result",
			"sub.child1.conversation→sub.child1:history",
			"sub.child1→sub.child1.clock:tool.clock",
			"sub.child1→sub.child1.conversation:append",
			"sub.child1→sub:reply",
			"sub→out:tool.result",
		],
	);

	// 任务发到了子 agent 的 conversation 里；子 agent 拿到快照已经去问模型了，超时也在飞。
	const child = s.graph.nodeStates["sub.child1.conversation"];
	assert.deepEqual(
		(child?.state as { history: { role: string }[] }).history.map((message) => message.role),
		["user"],
	);
	assert.equal(ofKind(s, "model.complete").length, 1);
	assert.equal(ofKind(s, "timer.wait").length, 1);

	const sub = s.graph.nodeStates.sub?.state as { children: Record<string, { phase: string }> };
	assert.equal(sub.children.c1?.phase, "running");
});

test("the child's reply comes back as a tool result and the child is reclaimed", async () => {
	const store = await setup();
	await ask(store);
	await run(store, registry, "w");
	await settle(store, ofKind(await snapshot(store), "graph.mutate")[0] as InFlightEffect);
	await run(store, registry, "w");

	const model = ofKind(await snapshot(store), "model.complete")[0] as InFlightEffect;
	await settle(store, model, answer("办好了"));
	await run(store, registry, "w");

	const s = await snapshot(store);
	const out = s.graph.nodeStates.out?.state as { results: JsonValue[] };
	assert.deepEqual(out.results, [
		{ type: "tool-result", callId: "c1", name: "subagent", ok: true, result: { text: "办好了" } },
	]);

	const sub = s.graph.nodeStates.sub?.state as { children: Record<string, unknown> };
	assert.deepEqual(sub.children, {}, "the call is closed out");
	assert.equal(ofKind(s, "graph.mutate").length, 1, "reclaiming the child is another graph mutation");

	await settle(store, ofKind(s, "graph.mutate")[0] as InFlightEffect);
	await run(store, registry, "w");
	const after = await snapshot(store);
	assert.deepEqual(Object.keys(after.graph.shape.nodes).sort(), ["out", "sub"], "the child is gone");

	// 超时那一条还在飞；子 agent 已经走了，它什么都不做。
	const timer = ofKind(after, "timer.wait")[0] as InFlightEffect;
	await settle(store, timer);
	await run(store, registry, "w");
	const last = await snapshot(store);
	assert.deepEqual((last.graph.nodeStates.out?.state as { results: JsonValue[] }).results.length, 1);
	assert.deepEqual(last.inFlight, []);
});

test("a timeout wins the race: a failure result goes back and the late reply is ignored", async () => {
	const store = await setup();
	await ask(store);
	await run(store, registry, "w");
	await settle(store, ofKind(await snapshot(store), "graph.mutate")[0] as InFlightEffect);
	await run(store, registry, "w");

	const waiting = await snapshot(store);
	const timer = ofKind(waiting, "timer.wait")[0] as InFlightEffect;
	const model = ofKind(waiting, "model.complete")[0] as InFlightEffect;

	// 超时先到：回失败结果、回收子 agent。
	await settle(store, timer);
	await run(store, registry, "w");

	const timedOut = await snapshot(store);
	const results = (timedOut.graph.nodeStates.out?.state as { results: { ok: boolean; result: { error: string } }[] })
		.results;
	assert.equal(results.length, 1);
	assert.equal(results[0]?.ok, false);
	assert.match(results[0]?.result.error ?? "", /timed out after 1000ms/);

	// 迟到的模型回执照样落盘（子 agent 还没被回收），它的回复被忽略。
	await settle(store, model, answer("太晚了"));
	await run(store, registry, "w");
	const late = await snapshot(store);
	assert.equal(
		(late.graph.nodeStates.out?.state as { results: JsonValue[] }).results.length,
		1,
		"only one result per call, ever",
	);
	assert.deepEqual((late.graph.nodeStates.sub?.state as { children: unknown }).children, {});
});

test("bad input never spawns anything", async () => {
	const store = await setup();
	await deliverToNode(store, "w", "sub", {
		type: "tool.subagent",
		body: { callId: "c9", name: "subagent", input: {} },
	});
	await run(store, registry, "w");

	const s = await snapshot(store);
	assert.deepEqual(s.inFlight, [], "no graph mutation, no child");
	const results = (s.graph.nodeStates.out?.state as { results: { ok: boolean; result: { error: string } }[] })
		.results;
	assert.equal(results[0]?.ok, false);
	assert.match(results[0]?.result.error ?? "", /invalid input/);
});

test("a rejected graph mutation comes back as a failed result, not a hanging call", async () => {
	const store = createMemoryStore();
	const broken: WorkflowTemplate = {
		nodes: {
			sub: {
				definition: "subagent",
				// 片段点名一份注册表里没有的工具定义：改图会被内核拒掉。
				config: {
					fragment: { ...fragment, tools: [{ id: "ghost", definition: "ghost", config: null, name: "ghost" }] },
					timeoutMs: 1000,
				},
			},
			out: { definition: "recorder", config: null },
		},
		edges: [{ from: "sub", to: "out", port: "tool.result" }],
	};
	await createWorkflow(store, registry, broken, { id: "w" });
	await ask(store);
	await run(store, registry, "w");

	const spawn = ofKind(await snapshot(store), "graph.mutate")[0] as InFlightEffect;
	assert.equal(await performGraphMutate(store, registry, "w", spawn.effectId), "rejected");
	await run(store, registry, "w");

	const s = await snapshot(store);
	const results = (s.graph.nodeStates.out?.state as { results: { ok: boolean; result: { error: string } }[] })
		.results;
	assert.equal(results.length, 1);
	assert.equal(results[0]?.ok, false);
	assert.deepEqual((s.graph.nodeStates.sub?.state as { children: unknown }).children, {}, "no child to wait for");
	assert.deepEqual(s.inFlight, [], "nothing is left hanging");
});
