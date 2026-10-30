import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWorkflowShape, edgeSchema, workflowShapeSchema, type WorkflowShape } from "../../src/workflow/shape/index.ts";

const node = { definition: "d", config: null };
const shape = (over: Partial<WorkflowShape> = {}): WorkflowShape => ({
	nodes: { a: node, b: node },
	edges: [],
	triggers: [],
	...over,
});
const codes = (s: WorkflowShape) => checkWorkflowShape(s).map((v) => v.code);

test("a valid shape has no violations; self loops are legal", () => {
	const s = shape({
		edges: [
			{ from: "a", to: "b", port: "tool.x" },
			{ from: "b", to: "a", port: "reply" },
			{ from: "a", to: "a", port: "retry" },
			{ from: "t", to: "a", port: "text" },
			{ from: "t", to: "b", port: "callback" },
		],
		triggers: [{ id: "t", kind: "telegram", config: {} }],
	});
	assert.deepEqual(checkWorkflowShape(s), []);
	assert.ok(workflowShapeSchema.safeParse(s).success);
});

test("one port can feed several targets: the edge table is the cardinality (ADR-0011)", () => {
	const s = shape({
		edges: [
			{ from: "a", to: "b", port: "p" },
			{ from: "a", to: "a", port: "p" },
		],
	});
	assert.deepEqual(codes(s), []);
});

test("same port from different nodes is fine", () => {
	const s = shape({
		edges: [
			{ from: "a", to: "b", port: "p" },
			{ from: "b", to: "a", port: "p" },
		],
	});
	assert.deepEqual(codes(s), []);
});

test("an exact duplicate edge is rejected: the same (from, port, to) twice", () => {
	assert.deepEqual(
		codes(
			shape({
				edges: [
					{ from: "a", to: "b", port: "p" },
					{ from: "a", to: "b", port: "p" },
				],
			}),
		),
		["edge_duplicate"],
	);
});

test("different ports from one node may reach the same target", () => {
	const s = shape({
		edges: [
			{ from: "a", to: "b", port: "p" },
			{ from: "a", to: "b", port: "q" },
		],
	});
	assert.deepEqual(codes(s), []);
});

test("an edge without a port is not a valid edge at all", () => {
	assert.ok(!edgeSchema.safeParse({ from: "a", to: "b" }).success);
});

test("edges must start at a live node or trigger and end at a live node", () => {
	const t = { id: "t", kind: "k", config: null };
	assert.deepEqual(codes(shape({ edges: [{ from: "ghost", to: "a", port: "p" }] })), [
		"edge_dangling",
	]);
	assert.deepEqual(codes(shape({ edges: [{ from: "a", to: "ghost", port: "p" }] })), [
		"edge_dangling",
	]);
	// a trigger has no mailbox, so it cannot be a target
	assert.deepEqual(
		codes(shape({ triggers: [t], edges: [{ from: "a", to: "t", port: "p" }] })),
		["edge_dangling"],
	);
});

test("a trigger output can feed several targets, like a node port (ADR-0011)", () => {
	const s = shape({
		triggers: [{ id: "t", kind: "k", config: null }],
		edges: [
			{ from: "t", to: "a", port: "text" },
			{ from: "t", to: "b", port: "text" },
		],
	});
	assert.deepEqual(codes(s), []);
});

test("trigger ids are unique and do not collide with node ids", () => {
	const t = { id: "t", kind: "k", config: null };
	assert.deepEqual(codes(shape({ triggers: [t, t] })), ["trigger_duplicate_id"]);
	assert.deepEqual(codes(shape({ triggers: [{ ...t, id: "a" }] })), ["id_collision"]);
});

test("port names cannot use the reserved prefix", () => {
	const s = shape({
		triggers: [{ id: "t", kind: "k", config: null }],
		edges: [{ from: "t", to: "a", port: "@effect.end" }],
	});
	assert.deepEqual(codes(s), ["edge_reserved_port"]);
});

test("node ids are the record keys; empty ids are rejected", () => {
	assert.ok(!workflowShapeSchema.safeParse(shape({ nodes: { "": node } })).success);
});
