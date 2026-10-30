import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { checkEffects } from "../../src/effect/index.ts";
import { defineNode } from "../../src/nodeDefinition.ts";
import { createRegistry } from "../../src/registry.ts";
import {
	type GraphOp,
	applyGraphMutation,
	graphMutateEffect,
	graphMutationResult,
} from "../../src/workflow/graph/index.ts";
import { checkSnapshot, type Snapshot } from "../../src/workflow/snapshot.ts";
import { instantiate } from "../../src/workflow/template/index.ts";

const worker = defineNode({
	name: "worker",
	version: 2,
	state: z.object({ n: z.number() }).default({ n: 0 }),
	config: z.object({ label: z.string().default("w") }),
	ports: () => ({ out: z.null(), alt: z.null() }),
	step: ({ state }) => ({ state }),
});

const registry = createRegistry({
	nodes: [worker],
	triggers: [{ kind: "hook", config: z.object({}), outputs: () => ({ text: z.string() }) }],
});

const base = (): Snapshot =>
	instantiate(registry, {
		nodes: {
			a: { definition: "worker", config: {} },
			b: { definition: "worker", config: {} },
		},
		edges: [{ from: "a", to: "b", port: "out" }],
		triggers: [{ id: "t", kind: "hook", config: {} }],
	});

const apply = (ops: GraphOp[], snapshot = base()) => applyGraphMutation(registry, snapshot, ops);
const okSnapshot = (ops: GraphOp[], snapshot = base()): Snapshot => {
	const r = apply(ops, snapshot);
	assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
	assert.deepEqual(checkSnapshot(r.snapshot), []);
	return r.snapshot;
};
const codes = (ops: GraphOp[], snapshot = base()): string[] => {
	const r = apply(ops, snapshot);
	return r.ok ? [] : r.violations.map((v) => v.code);
};

test("spawn adds the node with its initial state, version and an empty mailbox", () => {
	const s = okSnapshot([{ op: "spawn", id: "c", definition: "worker", config: {} }]);
	assert.deepEqual(s.graph.nodeStates.c, { version: 2, state: { n: 0 }, mailbox: [] });
	assert.deepEqual(s.graph.shape.nodes.c, { definition: "worker", config: { label: "w" } });
});

test("spawn and connect in one batch: the new node can be wired immediately", () => {
	const s = okSnapshot([
		{ op: "connect", from: "c", to: "a", port: "out" }, // listed before spawn: order is fixed, not textual
		{ op: "spawn", id: "c", definition: "worker", config: {}, state: { n: 7 } },
	]);
	assert.deepEqual(s.graph.nodeStates.c?.state, { n: 7 });
	assert.ok(s.graph.shape.edges.some((e) => e.from === "c" && e.to === "a"));
});

test("a port can be re-wired in one batch: disconnect runs before connect", () => {
	const s = okSnapshot([
		{ op: "connect", from: "a", to: "a", port: "out" },
		{ op: "disconnect", from: "a", to: "b", port: "out" },
	]);
	assert.deepEqual(s.graph.shape.edges, [{ from: "a", to: "a", port: "out" }]);
});

test("a second target on the same port is a second subscriber, not a violation (ADR-0011)", () => {
	const s = okSnapshot([{ op: "connect", from: "a", to: "a", port: "out" }]);
	assert.deepEqual(s.graph.shape.edges, [
		{ from: "a", to: "b", port: "out" },
		{ from: "a", to: "a", port: "out" },
	]);
});

test("the very same edge twice is still rejected: the same (from, port, to)", () => {
	assert.deepEqual(codes([{ op: "connect", from: "a", to: "b", port: "out" }]), ["edge_duplicate"]);
});

test("retire removes the node, its state and mailbox, and every edge touching it", () => {
	const snap = base();
	snap.graph.shape.edges.push({ from: "t", to: "b", port: "text" }, { from: "b", to: "a", port: "alt" });
	const s = okSnapshot([{ op: "retire", id: "b" }], snap);
	assert.deepEqual(Object.keys(s.graph.shape.nodes), ["a"]);
	assert.deepEqual(Object.keys(s.graph.nodeStates), ["a"]);
	assert.deepEqual(s.graph.shape.edges, []);
	assert.equal(s.graph.shape.triggers.length, 1); // the trigger itself stays
});

test("retire drops in-flight effects whose origin is gone", () => {
	const snap = base();
	snap.inFlight = [
		{ effectId: "e1", origin: "b", kind: "k", input: null },
		{ effectId: "e2", origin: "a", kind: "k", input: null },
	];
	const s = okSnapshot([{ op: "retire", id: "b" }], snap);
	assert.deepEqual(s.inFlight.map((e) => e.effectId), ["e2"]);
});

test("triggers: add, wire its output, remove it (edges from it go too)", () => {
	const added = okSnapshot([
		{ op: "addTrigger", id: "t2", kind: "hook", config: {} },
		{ op: "connect", from: "t2", to: "a", port: "text" },
	]);
	assert.equal(added.graph.shape.triggers.length, 2);
	const removed = okSnapshot([{ op: "removeTrigger", id: "t2" }], added);
	assert.deepEqual(removed.graph.shape.triggers.map((t) => t.id), ["t"]);
	assert.ok(removed.graph.shape.edges.every((e) => e.from !== "t2"));
});

test("a bad batch changes nothing: all or nothing, and the input is never mutated", () => {
	const snap = base();
	const before = structuredClone(snap);
	const r = apply(
		[
			{ op: "spawn", id: "c", definition: "worker", config: {} },
			{ op: "retire", id: "ghost" },
		],
		snap,
	);
	assert.ok(!r.ok);
	assert.deepEqual(snap, before);
	// the valid spawn alone is not applied either
	assert.deepEqual(r.violations.map((v) => v.code), ["retire_unknown"]);
});

test("violations: taken id, unknown definition, undeclared port, unknown edge/trigger", () => {
	assert.deepEqual(codes([{ op: "spawn", id: "a", definition: "worker", config: {} }]), ["spawn_id_taken"]);
	assert.deepEqual(codes([{ op: "spawn", id: "c", definition: "nope", config: {} }]), ["node_definition_unknown"]);
	assert.deepEqual(codes([{ op: "spawn", id: "c", definition: "worker", config: { label: 1 } }]), ["node_config_invalid"]);
	assert.deepEqual(codes([{ op: "spawn", id: "c", definition: "worker", config: {}, state: { n: "x" } }]), ["spawn_state_invalid"]);
	assert.deepEqual(codes([{ op: "connect", from: "a", to: "ghost", port: "alt" }]), ["edge_dangling"]);
	assert.deepEqual(codes([{ op: "connect", from: "a", to: "b", port: "nope" }]), ["edge_port_undeclared"]);
	assert.deepEqual(codes([{ op: "disconnect", from: "b", to: "a", port: "out" }]), ["disconnect_unknown"]);
	assert.deepEqual(codes([{ op: "removeTrigger", id: "ghost" }]), ["remove_trigger_unknown"]);
	assert.deepEqual(codes([{ op: "addTrigger", id: "t", kind: "hook", config: {} }]), ["trigger_duplicate_id"]);
	assert.deepEqual(codes([{ op: "addTrigger", id: "t3", kind: "cron", config: {} }]), ["trigger_kind_unknown"]);
});

test("disconnect and retire can share a batch", () => {
	const s = okSnapshot([
		{ op: "disconnect", from: "a", to: "b", port: "out" },
		{ op: "retire", id: "b" },
	]);
	assert.deepEqual(Object.keys(s.graph.shape.nodes), ["a"]);
});

test("graph.mutate is built in: input is validated by checkEffects, hosts cannot re-register it", () => {
	assert.equal(registry.effectKind("graph.mutate"), graphMutateEffect);
	const ops = [{ op: "retire", id: "b" }];
	assert.deepEqual(checkEffects(registry, [{ kind: "graph.mutate", input: { ops } }]), []);
	assert.deepEqual(
		checkEffects(registry, [{ kind: "graph.mutate", input: { ops: [{ op: "explode" }] } }]).map((v) => v.code),
		["effect_input_invalid"],
	);
	assert.throws(() => createRegistry({ effects: [graphMutateEffect] }), /duplicate effect kind/);
});

test("the result is plain JSON that the declared result schema accepts", () => {
	const ok = graphMutationResult(apply([]));
	assert.ok(graphMutateEffect.result.safeParse(ok).success);
	const bad = graphMutationResult(apply([{ op: "retire", id: "ghost" }]));
	assert.ok(graphMutateEffect.result.safeParse(bad).success);
	assert.deepEqual(bad, { ok: false, violations: [{ code: "retire_unknown", id: "ghost" }] });
});
