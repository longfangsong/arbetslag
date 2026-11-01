import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
	InstantiateError,
	type Subscription,
	UnknownMatcher,
	applyGraphMutation,
	checkMatchSpec,
	createRegistry,
	defineMatcher,
	defineNode,
	evaluateMatch,
	graphOpSchema,
	instantiate,
	selectSubscribers,
} from "../src/index.ts";

const textIs = defineMatcher({
	name: "textIs",
	config: z.object({ text: z.string() }),
	match: (event, config) => (event.body as { text?: string }).text === config.text,
});

const boom = defineMatcher({
	name: "boom",
	config: z.unknown(),
	match: () => {
		throw new Error("boom");
	},
});

const sink = defineNode({
	name: "sink",
	version: 1,
	state: z.null().default(null),
	config: z.null(),
	ports: () => ({}),
	step: ({ state }) => ({ state }),
});

const registry = createRegistry({
	nodes: [sink],
	triggers: [{ kind: "hook", config: z.object({}), outputs: () => ({ text: z.object({ text: z.string() }) }) }],
	matchers: [textIs, boom],
});

const event = (text: string) => ({ output: "text", body: { text } });

const sub = (workflowId: string, extra: Partial<Subscription> = {}): Subscription => ({
	workflowId,
	trigger: "t",
	group: "",
	priority: 0,
	...extra,
});

test("the framework matchers come with every registry; app matchers cannot shadow them", () => {
	assert.ok(registry.matcher("always"));
	assert.ok(registry.matcher("all"));
	assert.ok(registry.matcher("any"));
	assert.ok(registry.effectKind("workflow.spawn"));
	assert.throws(() => createRegistry({ matchers: [{ ...textIs, name: "always" }] }), /duplicate matcher/);
});

test("a missing match means every event; all / any compose nested matchers", () => {
	assert.equal(evaluateMatch(registry, undefined, event("x")), true);
	const both = { fn: "all", config: { of: [{ fn: "always", config: null }, { fn: "textIs", config: { text: "hi" } }] } };
	assert.equal(evaluateMatch(registry, both, event("hi")), true);
	assert.equal(evaluateMatch(registry, both, event("no")), false);
	const either = { fn: "any", config: { of: [{ fn: "textIs", config: { text: "a" } }, { fn: "textIs", config: { text: "b" } }] } };
	assert.equal(evaluateMatch(registry, either, event("b")), true);
	assert.equal(evaluateMatch(registry, either, event("c")), false);
	assert.throws(() => evaluateMatch(registry, { fn: "ghost" }, event("x")), UnknownMatcher);
});

test("match specs are validated recursively against the registry", () => {
	assert.equal(checkMatchSpec(registry, { fn: "textIs", config: { text: "a" } }), undefined);
	assert.match(checkMatchSpec(registry, { fn: "ghost" }) ?? "", /unknown matcher/);
	assert.match(checkMatchSpec(registry, { fn: "textIs", config: { text: 1 } }) ?? "", /textIs/);
	assert.match(checkMatchSpec(registry, { fn: "all", config: { of: [{ fn: "ghost" }] } }) ?? "", /ghost/);
});

test("a trigger with an unknown matcher is an invalid declaration (instantiate and mutate)", () => {
	const template = {
		nodes: { a: { definition: "sink", config: null } },
		triggers: [{ id: "t", kind: "hook", listener: "l", match: { fn: "ghost" } }],
	};
	assert.throws(
		() => instantiate(registry, template),
		(e) => e instanceof InstantiateError && e.violations.some((v) => v.code === "trigger_match_invalid"),
	);

	const fine = instantiate(registry, { nodes: { a: { definition: "sink", config: null } } });
	const ops = graphOpSchema
		.array()
		.parse([{ op: "addTrigger", id: "t", kind: "hook", listener: "l", match: { fn: "textIs", config: {} } }]);
	const result = applyGraphMutation(registry, fine, ops);
	assert.equal(result.ok, false);
	assert.ok(!result.ok && result.violations.some((v) => v.code === "trigger_match_invalid"));
});

test("trigger defaults land in the snapshot: group '', priority 0, config {}", () => {
	const snap = instantiate(registry, {
		nodes: { a: { definition: "sink", config: null } },
		triggers: [{ id: "t", kind: "hook", listener: "l" }],
	});
	assert.deepEqual(snap.graph.shape.triggers, [{ id: "t", kind: "hook", listener: "l", group: "", priority: 0, config: {} }]);
});

test("within a group only the highest matching layer receives, all of it", () => {
	const subs = [sub("a"), sub("b"), sub("fallback", { priority: -1 })];
	assert.deepEqual(
		selectSubscribers(registry, subs, event("x")).targets.map((s) => s.workflowId),
		["a", "b"],
	);

	const chat = [sub("a", { match: { fn: "textIs", config: { text: "mine" } } }), sub("fallback", { priority: -1 })];
	assert.deepEqual(selectSubscribers(registry, chat, event("other")).targets.map((s) => s.workflowId), ["fallback"]);
	assert.deepEqual(selectSubscribers(registry, chat, event("mine")).targets.map((s) => s.workflowId), ["a"]);
});

test("groups are independent: an audit catch-all does not starve the fallback", () => {
	const subs = [
		sub("audit", { group: "audit" }),
		sub("a", { match: { fn: "textIs", config: { text: "mine" } } }),
		sub("fallback", { priority: -1 }),
	];
	assert.deepEqual(
		selectSubscribers(registry, subs, event("new")).targets.map((s) => s.workflowId),
		["audit", "fallback"],
	);
	assert.deepEqual(
		selectSubscribers(registry, subs, event("mine")).targets.map((s) => s.workflowId),
		["a", "audit"],
	);
});

test("a matcher that throws or is missing counts as no match and is reported", () => {
	const subs = [sub("bad", { match: { fn: "boom" } }), sub("gone", { match: { fn: "ghost" } }), sub("fallback", { priority: -1 })];
	const selection = selectSubscribers(registry, subs, event("x"));
	assert.deepEqual(selection.targets.map((s) => s.workflowId), ["fallback"]);
	assert.deepEqual(selection.failures.map((f) => f.subscription.workflowId), ["bad", "gone"]);
});

test("no subscriptions, no targets", () => {
	assert.deepEqual(selectSubscribers(registry, [], event("x")), { targets: [], failures: [] });
});
