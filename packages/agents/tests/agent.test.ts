import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import {
	type EffectRequest,
	type Registry,
	type SnapshotStore,
	type StepInput,
	type WorkflowTemplate,
	completeEffect,
	createMemoryStore,
	createRegistry,
	createWorkflow,
	defineNode,
	deliverToNode,
	run,
} from "@arbetslag/kernel";
import {
	AGENT_NAME,
	type AgentConfig,
	type AgentState,
	TOOL_RESULT_PORT,
	agent,
	agentLayout,
	agentConfigSchema,
	agentStateSchema,
	defineTool,
	modelCompleteKind,
	textMessage,
	toolResult,
} from "../src/index.ts";

const anyJson: z.ZodType<JsonValue> = z.json();

/** 一个把调用原样加一的工具。 */
const plusOne = defineTool({
	name: "plus_one",
	description: "加一",
	input: z.object({ n: z.number() }),
	state: z.object({ calls: z.number() }).default({ calls: 0 }),
	config: z.null(),
	run: ({ call, state }) => ({
		state: { calls: state.calls + 1 },
		result: { n: (call.input as { n: number }).n + 1 },
	}),
});

/** 记账节点：收到 `reply` 就记下来。 */
const recorder = defineNode({
	name: "recorder",
	version: 1,
	state: z.object({ replies: z.array(anyJson) }).default({ replies: [] }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => ({ state: { replies: [...state.replies, message.body] } }),
});

const registry = createRegistry({
	nodes: [agent, plusOne, recorder],
	effects: [modelCompleteKind],
});

const layout = agentLayout({
	agent: "bot",
	config: { model: "fake-1", system: "你是个助手" },
	tools: [{ tool: plusOne }],
});

const template: WorkflowTemplate = {
	nodes: { ...layout.nodes, out: { definition: "recorder", config: null } },
	edges: [...layout.edges, { from: "bot", to: "out", port: "reply" }],
};

async function setup() {
	const store = createMemoryStore();
	await createWorkflow(store, registry, template, { id: "w" });
	return store;
}

const snapshot = async (store: SnapshotStore, id = "w") => {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new Error("missing workflow");
	return loaded.snapshot;
};

const stateOf = async (store: SnapshotStore): Promise<AgentState> => {
	const s = await snapshot(store);
	return s.graph.nodeStates.bot?.state as AgentState;
};

/** 运行脚本化的模型：每次拿到效果就取一条预设结果，直到图里没有在飞的东西。 */
async function play(store: SnapshotStore, replies: JsonValue[], id = "w") {
	const queue = [...replies];
	for (let round = 0; round < 20; round++) {
		await run(store, registry, id);
		const s = await snapshot(store, id);
		if (s.halted !== undefined) return s;
		if (s.inFlight.length === 0) return s;
		for (const effect of s.inFlight) {
			const reply = queue.shift();
			assert.ok(reply !== undefined, "the agent asked more often than scripted");
			await completeEffect(store, id, effect.effectId, reply);
		}
	}
	throw new Error("the graph never settled");
}

const answer = (blocks: Parameters<typeof toolResult>[0] extends never ? never : JsonValue) => ({
	ok: true as const,
	message: { role: "assistant" as const, blocks: blocks as never },
});

test("defineTool answers a call on the tool.result port, validating the model's input", () => {
	const ok = plusOne.step({
		self: "t",
		config: null,
		state: { calls: 0 },
		message: { type: "tool.plus_one", body: { callId: "c1", name: "plus_one", input: { n: 1 } } },
	} as StepInput<{ calls: number }, null>);
	assert.deepEqual(ok.sends, [
		{ port: TOOL_RESULT_PORT, body: { type: "tool-result", callId: "c1", name: "plus_one", ok: true, result: { n: 2 } } },
	]);

	const bad = plusOne.step({
		self: "t",
		config: null,
		state: { calls: 0 },
		message: { type: "tool.plus_one", body: { callId: "c2", name: "plus_one", input: { n: "no" } } },
	} as unknown as StepInput<{ calls: number }, null>);
	const result = bad.sends?.[0]?.body as { ok: boolean; result: { error: string } };
	assert.equal(result.ok, false);
	assert.match(result.result.error, /invalid input/);
});

test("a user message becomes a model.complete effect carrying history and tools", async () => {
	const store = await setup();
	await deliverToNode(store, "w", "bot", { type: "user", body: { text: "你好" } });
	await run(store, registry, "w");

	const s = await snapshot(store);
	assert.equal(s.inFlight.length, 1);
	const effect = s.inFlight[0];
	assert.equal(effect?.kind, "model.complete");
	const input = effect?.input as {
		model: string;
		messages: { role: string }[];
		tools: { name: string }[];
	};
	assert.equal(input.model, "fake-1");
	assert.deepEqual(
		input.messages.map((m) => m.role),
		["system", "user"],
		"the system prompt is prepended but not stored in history",
	);
	assert.deepEqual(input.tools, [
		{
			name: "plus_one",
			description: "加一",
			input: {
				type: "object",
				properties: { n: { type: "number" } },
				required: ["n"],
				additionalProperties: false,
			},
		},
	]);
	assert.deepEqual((await stateOf(store)).history, [
		{ role: "user", blocks: [{ type: "text", text: "你好" }] },
	]);
});

test("a plain answer goes out on reply and into history", async () => {
	const store = await setup();
	await deliverToNode(store, "w", "bot", { type: "user", body: { text: "你好" } });
	const s = await play(store, [answer([{ type: "text", text: "在的" }])]);

	assert.equal(s.halted, undefined);
	const state = await stateOf(store);
	assert.deepEqual(
		state.history.map((message) => message.role),
		["user", "assistant"],
	);
	assert.equal(state.modelCall, undefined);
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["在的"]);
});

test("a tool call goes out on tool.<name>, and the result brings the model back", async () => {
	const store = await setup();
	await deliverToNode(store, "w", "bot", { type: "user", body: { text: "41 加一是几" } });

	const s = await play(store, [
		answer([{ type: "tool-call", callId: "c1", name: "plus_one", input: { n: 41 } }]),
		answer([{ type: "text", text: "是 42" }]),
	]);

	const state = await stateOf(store);
	assert.deepEqual(
		state.history.map((message) => message.role),
		["user", "assistant", "tool", "assistant"],
	);
	const call = state.history[1]?.blocks[0];
	assert.equal(call?.type, "tool-call");
	const result = state.history[2]?.blocks[0] as unknown as { ok: boolean; result: { n: number } };
	assert.deepEqual(result.result, { n: 42 });
	assert.deepEqual(state.pending, {}, "the wait set is empty again");
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["是 42"]);
	assert.deepEqual((s.graph.nodeStates["bot.plus_one"]?.state as { calls: number }).calls, 1);
});

test("a tool the agent has no port for becomes a failed tool result, not a crash", async () => {
	const store = await setup();
	await deliverToNode(store, "w", "bot", { type: "user", body: { text: "用一下没有的工具" } });

	const s = await play(store, [
		answer([{ type: "tool-call", callId: "c9", name: "nope", input: {} }]),
		answer([{ type: "text", text: "那算了" }]),
	]);

	assert.equal(s.halted, undefined, "nothing was sent to a port that does not exist");
	const state = await stateOf(store);
	const failure = state.history[2]?.blocks[0] as unknown as { ok: boolean; result: { error: string } };
	assert.equal(failure.ok, false);
	assert.match(failure.result.error, /unknown tool: nope/);
});

test("a failed model call is answered as text, and the agent stays usable", async () => {
	const store = await setup();
	await deliverToNode(store, "w", "bot", { type: "user", body: { text: "你好" } });
	const s = await play(store, [{ ok: false, error: "rate limited" }]);

	assert.equal(s.halted, undefined);
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.match(out.replies[0]?.text ?? "", /rate limited/);
	assert.equal((await stateOf(store)).modelCall, undefined);
});

test("a receipt for another call is ignored", () => {
	const state = agentStateSchema.parse({ modelCall: "m2" });
	const transition = agent.step({
		self: "bot",
		config: agentConfigSchema.parse({ model: "m" }),
		state,
		message: {
			type: "@effect.end",
			body: { correlationId: "m1", result: { ok: true, message: textMessage("assistant", "假的") } },
		},
	});

	assert.deepEqual(transition, { state }, "another call's receipt changes nothing");
});

test("a tool call in flight holds the next model call back", () => {
	const state = agentStateSchema.parse({ pending: { c1: "plus_one" }, nextCall: 3 });
	const transition = agent.step({
		self: "bot",
		config: agentConfigSchema.parse({ model: "m" }),
		state,
		message: { type: "user", body: { text: "第二句" } },
	});

	assert.deepEqual(transition.effects, undefined, "the wait set is not empty yet");
	assert.deepEqual(transition.sends, undefined);
	const next = transition.state;
	assert.deepEqual(
		next.history.map((message) => message.role),
		["user"],
		"the words are still recorded",
	);
	assert.equal(next.modelCall, undefined);
});

test("words that arrive while the model is thinking are kept for the next call", async () => {
	const store = await setup();
	await deliverToNode(store, "w", "bot", { type: "user", body: { text: "第一句" } });
	await run(store, registry, "w");

	await deliverToNode(store, "w", "bot", { type: "user", body: { text: "第二句" } });
	await run(store, registry, "w");

	const waiting = await snapshot(store);
	assert.equal(waiting.inFlight.length, 1, "still the one call that is already out");

	const effect = waiting.inFlight[0];
	assert.ok(effect !== undefined);
	await completeEffect(store, "w", effect.effectId, answer([{ type: "text", text: "都听到了" }]));
	await run(store, registry, "w");

	const state = await stateOf(store);
	assert.deepEqual(
		state.history.map((message) => message.role),
		["user", "user", "assistant"],
	);
	const out = (await snapshot(store)).graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["都听到了"]);
});

test("agentLayout copies tool schemas and wires both directions", () => {
	assert.deepEqual(layout.edges, [
		{ from: "bot", to: "bot.plus_one", port: "tool.plus_one" },
		{ from: "bot.plus_one", to: "bot", port: TOOL_RESULT_PORT },
	]);
	const config = layout.nodes.bot?.config as AgentConfig;
	assert.equal(config.model, "fake-1");
	assert.deepEqual(
		config.tools.map((tool) => tool.name),
		["plus_one"],
	);
	assert.deepEqual(Object.keys(layout.nodes), [AGENT_NAME === "agent" ? "bot" : "bot", "bot.plus_one"]);
	assert.equal(layout.nodes["bot.plus_one"]?.definition, "plus_one");
});

test("the agent's ports are a function of its tool list", () => {
	const ports = agent.ports(agentConfigSchema.parse({ model: "m", tools: [] }));
	assert.deepEqual(Object.keys(ports), ["reply", TOOL_RESULT_PORT]);
	const withTool = agent.ports(
		agentConfigSchema.parse({
			model: "m",
			tools: [{ name: "plus_one", description: "", input: {} }],
		}),
	);
	assert.deepEqual(Object.keys(withTool).sort(), ["reply", "tool.plus_one", TOOL_RESULT_PORT].sort());
});

test("state defaults make an agent usable from an empty template entry", () => {
	assert.deepEqual(agentStateSchema.parse(undefined), { history: [], pending: {}, nextCall: 0 });
});

test("the model.complete kind is what the registry holds", () => {
	const registryWithKind: Registry = createRegistry({ nodes: [agent], effects: [modelCompleteKind] });
	assert.equal(registryWithKind.effectKind("model.complete")?.kind, "model.complete");
	assert.equal(registryWithKind.effectKind("model.complete")?.input.safeParse({ model: "m", messages: [] }).success, true);
	assert.equal(registryWithKind.effectKind("model.complete")?.input.safeParse({ messages: [] }).success, false);
});

