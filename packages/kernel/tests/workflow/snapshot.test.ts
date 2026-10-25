import assert from "node:assert/strict";
import { test } from "node:test";
import {
	checkSnapshot,
	isHalted,
	isQuiescent,
	needsRecovery,
	snapshotSchema,
	type Snapshot,
} from "../../src/workflow/snapshot.ts";
import { haltCodes, haltReasonSchema } from "../../src/halt.ts";

const node = { definition: "d", config: null };
const base = (): Snapshot => ({
	graph: {
		shape: { nodes: { a: node, b: node }, edges: [{ from: "a", to: "b", port: "p" }], triggers: [] },
		nodeStates: {
			a: { version: 1, state: {}, mailbox: [] },
			b: { version: 1, state: {}, mailbox: [] },
		},
	},
	inFlight: [],
	nextSeq: 0,
});
const entry = (seq: number) => ({ seq, message: { type: "x", body: null } });
const codes = (s: Snapshot) => checkSnapshot(s).map((v) => v.code);

test("a consistent snapshot has no violations", () => {
	const s = base();
	assert.deepEqual(checkSnapshot(s), []);
	assert.ok(snapshotSchema.safeParse(s).success);
});

test("shape and node states correspond one to one", () => {
	const missing = base();
	delete missing.graph.nodeStates.b;
	assert.deepEqual(codes(missing), ["node_state_missing"]);

	const orphan = base();
	orphan.graph.nodeStates.ghost = { version: 1, state: null, mailbox: [] };
	assert.deepEqual(codes(orphan), ["node_state_orphan"]);
});

test("shape violations surface through the graph and snapshot checks", () => {
	const s = base();
	s.graph.shape.edges.push({ from: "a", to: "ghost", port: "q" });
	assert.deepEqual(codes(s), ["edge_dangling"]);
});

test("mailbox seq is strictly increasing and below nextSeq", () => {
	const s = base();
	s.nextSeq = 5;
	s.graph.nodeStates.a!.mailbox = [entry(3), entry(3)];
	assert.deepEqual(codes(s), ["mailbox_unordered"]);

	const ahead = base();
	ahead.nextSeq = 2;
	ahead.graph.nodeStates.a!.mailbox = [entry(1), entry(2)];
	assert.deepEqual(codes(ahead), ["mailbox_seq_ahead"]);
});

test("in-flight effects need a live origin and a unique effectId", () => {
	const s = base();
	const fx = { effectId: "e1", origin: "a", kind: "k", input: null };
	s.inFlight = [fx, fx, { ...fx, effectId: "e2", origin: "ghost" }];
	assert.deepEqual(codes(s), ["in_flight_duplicate_id", "in_flight_orphan"]);
});

test("quiescent means every mailbox is empty, regardless of in-flight effects", () => {
	const s = base();
	s.inFlight = [{ effectId: "e1", origin: "a", kind: "k", input: null }];
	assert.ok(isQuiescent(s));
	s.graph.nodeStates.b!.mailbox = [entry(0)];
	s.nextSeq = 1;
	assert.ok(!isQuiescent(s));
});

test("needsRecovery: run when active with mail, effects when in flight", () => {
	const s = base();
	assert.deepEqual(needsRecovery(s), { run: false, effects: false });

	s.graph.nodeStates.a!.mailbox = [entry(0)];
	s.nextSeq = 1;
	s.inFlight = [{ effectId: "e1", origin: "a", kind: "k", input: null }];
	assert.deepEqual(needsRecovery(s), { run: true, effects: true });

	s.halted = { code: "step_threw", node: "a", detail: "boom", at: "2026-10-25T00:00:00.000Z" };
	assert.ok(isHalted(s));
	assert.deepEqual(needsRecovery(s), { run: false, effects: true });
});

test("halted carries a code from the closed enum", () => {
	const ok = { code: "version_ahead", detail: "x", at: "2026-10-25T00:00:00.000Z" };
	assert.ok(haltReasonSchema.safeParse(ok).success);
	assert.ok(!haltReasonSchema.safeParse({ ...ok, code: "whatever" }).success);
	assert.ok(!haltReasonSchema.safeParse({ ...ok, at: "yesterday" }).success);
	assert.equal(new Set(haltCodes).size, haltCodes.length);
});
