import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineNode } from "../../src/nodeDefinition.ts";
import { createMemoryStore } from "../../src/memoryStore.ts";
import { createRegistry } from "../../src/registry.ts";
import { Conflict } from "../../src/snapshotStore.ts";
import { checkSnapshot } from "../../src/workflow/snapshot.ts";
import { createWorkflow, instantiate, InstantiateError } from "../../src/workflow/template/index.ts";

const agent = defineNode({
	name: "agent",
	version: 3,
	state: z.object({ history: z.array(z.string()) }).default({ history: [] }),
	config: z.object({ tools: z.array(z.string()).default([]) }),
	ports: (config) => ({
		reply: z.string(),
		...Object.fromEntries(config.tools.map((t) => [`tool.${t}`, z.null()])),
	}),
	step: ({ state }) => ({ state }),
});

const sink = defineNode({
	name: "sink",
	version: 1,
	state: z.object({ n: z.number() }), // no default: the template must give it
	config: z.null(),
	ports: () => ({}),
	step: ({ state }) => ({ state }),
});

const registry = createRegistry({
	nodes: [agent, sink],
	triggers: [
		{
			kind: "webhook",
			config: z.object({ path: z.string() }),
			outputs: () => ({ text: z.string() }),
		},
	],
});

const codes = (fn: () => unknown): string[] => {
	try {
		fn();
	} catch (e) {
		if (e instanceof InstantiateError) return e.violations.map((v) => v.code);
		throw e;
	}
	return [];
};

test("instantiate builds a consistent snapshot: empty mailboxes, no effects in flight", () => {
	const snap = instantiate(registry, {
		nodes: { bot: { definition: "agent", config: {} }, out: { definition: "sink", config: null, state: { n: 0 } } },
		edges: [{ from: "bot", to: "out", port: "reply" }],
		triggers: [{ id: "hook", kind: "webhook", config: { path: "/x" } }],
	});
	assert.deepEqual(checkSnapshot(snap), []);
	assert.equal(snap.nextSeq, 0);
	assert.deepEqual(snap.inFlight, []);
	assert.deepEqual(snap.graph.nodeStates.bot, { version: 3, state: { history: [] }, mailbox: [] });
	assert.deepEqual(snap.graph.nodeStates.out, { version: 1, state: { n: 0 }, mailbox: [] });
});

test("defaults are materialized: config and initial state come from the parsed output", () => {
	const snap = instantiate(registry, { nodes: { bot: { definition: "agent", config: {} } } });
	assert.deepEqual(snap.graph.shape.nodes.bot?.config, { tools: [] });
	assert.deepEqual(snap.graph.nodeStates.bot?.state, { history: [] });
});

test("a given state wins over the schema default", () => {
	const snap = instantiate(registry, {
		nodes: { bot: { definition: "agent", config: {}, state: { history: ["hi"] } } },
	});
	assert.deepEqual(snap.graph.nodeStates.bot?.state, { history: ["hi"] });
});

test("the template is read once: later template edits do not reach the snapshot", () => {
	const template = { nodes: { bot: { definition: "agent", config: { tools: ["a"] } } } };
	const snap = instantiate(registry, template);
	template.nodes.bot.config.tools.push("b");
	assert.deepEqual(snap.graph.shape.nodes.bot?.config, { tools: ["a"] });
});

test("a node with no default state and no state in the template is rejected", () => {
	assert.deepEqual(
		codes(() => instantiate(registry, { nodes: { out: { definition: "sink", config: null } } })),
		["node_state_invalid"],
	);
});

test("unknown definition, bad config, undeclared port are all reported together", () => {
	const v = codes(() =>
		instantiate(registry, {
			nodes: {
				a: { definition: "ghost", config: null },
				b: { definition: "agent", config: { tools: "x" } },
				c: { definition: "agent", config: {} },
			},
			edges: [{ from: "c", to: "c", port: "tool.nope" }],
		}),
	);
	assert.deepEqual(v, ["node_definition_unknown", "node_config_invalid", "edge_port_undeclared"]);
});

test("ports follow config: a tool port exists only when the config lists it", () => {
	const ok = { nodes: { bot: { definition: "agent", config: { tools: ["t"] } } }, edges: [{ from: "bot", to: "bot", port: "tool.t" }] };
	assert.deepEqual(codes(() => instantiate(registry, ok)), []);
	const bad = { nodes: { bot: { definition: "agent", config: { tools: [] } } }, edges: [{ from: "bot", to: "bot", port: "tool.t" }] };
	assert.deepEqual(codes(() => instantiate(registry, bad)), ["edge_port_undeclared"]);
});

test("triggers: unknown kind, bad config, undeclared output", () => {
	const node = { bot: { definition: "agent", config: {} } };
	assert.deepEqual(
		codes(() => instantiate(registry, { nodes: node, triggers: [{ id: "t", kind: "cron", config: null }] })),
		["trigger_kind_unknown"],
	);
	assert.deepEqual(
		codes(() => instantiate(registry, { nodes: node, triggers: [{ id: "t", kind: "webhook", config: {} }] })),
		["trigger_config_invalid"],
	);
	assert.deepEqual(
		codes(() =>
			instantiate(registry, {
				nodes: node,
				triggers: [{ id: "t", kind: "webhook", config: { path: "/" } }],
				edges: [{ from: "t", to: "bot", port: "callback" }],
			}),
		),
		["edge_port_undeclared"],
	);
	const fine = instantiate(registry, {
		nodes: node,
		triggers: [{ id: "t", kind: "webhook", config: { path: "/" } }],
		edges: [{ from: "t", to: "bot", port: "text" }],
	});
	assert.deepEqual(checkSnapshot(fine), []);
});

test("shape violations are reported too", () => {
	assert.deepEqual(
		codes(() => instantiate(registry, { nodes: { bot: { definition: "agent", config: {} } }, edges: [{ from: "bot", to: "ghost", port: "reply" }] })),
		["edge_dangling"],
	);
});

test("a malformed template is one violation, not a crash", () => {
	assert.deepEqual(codes(() => instantiate(registry, { nodes: { bot: { config: null } } } as never)), ["template_malformed"]);
});

test("createWorkflow saves under the given or a generated id; a taken id is a Conflict", async () => {
	const store = createMemoryStore();
	const template = { nodes: { bot: { definition: "agent", config: {} } } };

	const a = await createWorkflow(store, registry, template, { id: "w1" });
	assert.equal(a.id, "w1");
	assert.ok((await store.load("w1"))?.snapshot);

	const b = await createWorkflow(store, registry, template);
	assert.ok(b.id.length > 0 && b.id !== "w1");

	await assert.rejects(createWorkflow(store, registry, template, { id: "w1" }), Conflict);
});

test("an invalid template saves nothing", async () => {
	const store = createMemoryStore();
	await assert.rejects(
		createWorkflow(store, registry, { nodes: { a: { definition: "ghost", config: null } } }, { id: "w" }),
		InstantiateError,
	);
	assert.equal(await store.load("w"), undefined);
});
