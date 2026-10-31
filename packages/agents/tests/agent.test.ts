import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import {
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
	APPEND_PORT,
	type AgentConfig,
	type AgentState,
	CONVERSATION_NAME,
	HISTORY_PORT,
	TOOL_RESULT_PORT,
	agent,
	agentConfigSchema,
	agentLayout,
	agentStateSchema,
	answerable,
	conversation,
	conversationStateSchema,
	defineTool,
	historySchema,
	modelCompleteKind,
	text,
	textMessage,
	textOf,
} from "../src/index.ts";
import { historyMessageSchema } from "../src/index.ts";
import type { HistoryBlock, HistoryMessage } from "../src/index.ts";

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

const layout = agentLayout({
	agent: "bot",
	config: { model: "fake-1", system: "你是个助手" },
	tools: [{ tool: plusOne }],
});

/** 对话历史在 `chat` 这里；`bot` 只管问模型（ADR-0010）。 */
const graphOf = (edges: NonNullable<WorkflowTemplate["edges"]>): WorkflowTemplate => ({
	nodes: {
		...layout.nodes,
		chat: { definition: CONVERSATION_NAME, config: null },
		out: { definition: "recorder", config: null },
	},
	edges: [...layout.edges, ...edges],
});

const template = graphOf([
	{ from: "chat", to: "bot", port: HISTORY_PORT },
	{ from: "bot", to: "chat", port: APPEND_PORT },
	{ from: "bot", to: "out", port: "reply" },
]);

const registry = createRegistry({
	nodes: [agent, conversation, plusOne, recorder],
	effects: [modelCompleteKind],
});

async function setup(withJudge = false) {
	const store = createMemoryStore();
	await createWorkflow(store, registry, withJudge ? judgeTemplate : template, { id: "w" });
	return store;
}

const snapshot = async (store: SnapshotStore, id = "w") => {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new Error("missing workflow");
	return loaded;
};

const agentStateOf = async (store: SnapshotStore): Promise<AgentState> => {
	const s = await snapshot(store);
	return s.graph.nodeStates.bot?.state as AgentState;
};

const historyOf = async (store: SnapshotStore): Promise<HistoryMessage[]> => {
	const s = await snapshot(store);
	return (s.graph.nodeStates.chat?.state as { history: HistoryMessage[] }).history;
};

/** 运行脚本化的模型：每次拿到效果就取一条预设结果，直到图里没有在飞的东西。 */
async function play(store: SnapshotStore, replies: JsonValue[], id = "w", reg = registry) {
	const queue = [...replies];
	for (let round = 0; round < 20; round++) {
		await run(store, reg, id);
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

const answer = (...blocks: HistoryBlock[]): JsonValue => ({
	ok: true as const,
	message: { role: "assistant" as const, blocks },
});

const say = (store: SnapshotStore, text: string) =>
	deliverToNode(store, "w", "chat", { type: "user", body: { text } });

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

test("conversation records what it is given and hands out the whole history", () => {
	const asked = conversation.step({
		self: "chat",
		config: null,
		state: { history: [] },
		message: { type: "user", body: { text: "你好" } },
	});
	assert.deepEqual(asked.state.history, [{ role: "user", blocks: [text("你好")] }]);
	assert.deepEqual(asked.sends, [{ port: HISTORY_PORT, body: asked.state.history }]);

	const appended = conversation.step({
		self: "chat",
		config: null,
		state: conversationStateSchema.parse({ history: asked.state.history }),
		message: { type: APPEND_PORT, body: textMessage("assistant", "在的") },
	});
	assert.deepEqual(
		appended.state.history.map((message) => message.role),
		["user", "assistant"],
	);
	assert.deepEqual(appended.sends, [{ port: HISTORY_PORT, body: appended.state.history }]);

	const ignored = conversation.step({
		self: "chat",
		config: null,
		state: { history: [] },
		message: { type: "@effect.end", body: null },
	});
	assert.deepEqual(ignored, { state: { history: [] } });
});

test("a user message becomes a model.complete effect carrying history and tools", async () => {
	const store = await setup();
	await say(store, "你好");
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
		input.messages.map((message) => message.role),
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
	assert.deepEqual(await historyOf(store), [{ role: "user", blocks: [text("你好")] }]);
	assert.equal((await agentStateOf(store)).modelCall, "m1");
});

test("a plain answer goes out on reply and into history", async () => {
	const store = await setup();
	await say(store, "你好");
	const s = await play(store, [answer({ type: "text", text: "在的" })]);

	assert.equal(s.halted, undefined);
	const history = await historyOf(store);
	assert.deepEqual(
		history.map((message) => message.role),
		["user", "assistant"],
	);
	assert.equal((await agentStateOf(store)).modelCall, undefined);
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["在的"]);
});

test("a tool call goes out on tool.<name>, and the result brings the model back", async () => {
	const store = await setup();
	await say(store, "41 加一是几");

	const s = await play(store, [
		answer({ type: "tool-call", callId: "c1", name: "plus_one", input: { n: 41 } }),
		answer({ type: "text", text: "是 42" }),
	]);

	const history = await historyOf(store);
	assert.deepEqual(
		history.map((message) => message.role),
		["user", "assistant", "tool", "assistant"],
	);
	const call = history[1]?.blocks[0];
	assert.equal(call?.type, "tool-call");
	const result = history[2]?.blocks[0] as unknown as { ok: boolean; result: { n: number } };
	assert.deepEqual(result.result, { n: 42 });
	assert.deepEqual((await agentStateOf(store)).pending, {}, "the wait set is empty again");
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["是 42"]);
	assert.deepEqual((s.graph.nodeStates["bot.plus_one"]?.state as { calls: number }).calls, 1);
});

test("a tool the agent has no port for becomes a failed tool result, not a crash", async () => {
	const store = await setup();
	await say(store, "用一下没有的工具");

	const s = await play(store, [
		answer({ type: "tool-call", callId: "c9", name: "nope", input: {} }),
		answer({ type: "text", text: "那算了" }),
	]);

	assert.equal(s.halted, undefined, "nothing was sent to a port that does not exist");
	const history = await historyOf(store);
	assert.deepEqual(
		history.map((message) => message.role),
		["user", "assistant", "tool", "assistant"],
	);
	const failure = history[2]?.blocks[0] as unknown as { ok: boolean; result: { error: string } };
	assert.equal(failure.ok, false);
	assert.match(failure.result.error, /unknown tool: nope/);
});

test("a failed model call is answered as text, and the agent stays usable", async () => {
	const store = await setup();
	await say(store, "你好");
	const s = await play(store, [{ ok: false, error: "rate limited" }]);

	assert.equal(s.halted, undefined);
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.match(out.replies[0]?.text ?? "", /rate limited/);
	assert.equal((await agentStateOf(store)).modelCall, undefined);
	assert.deepEqual(
		(await historyOf(store)).map((message) => message.role),
		["user", "assistant"],
		"the failure is part of the record too",
	);
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

test("a history snapshot arrives while a tool call is in flight: no second model call", () => {
	const state = agentStateSchema.parse({ pending: { c1: "plus_one" }, nextCall: 3 });
	const transition = agent.step({
		self: "bot",
		config: agentConfigSchema.parse({ model: "m" }),
		state,
		message: { type: HISTORY_PORT, body: [{ role: "user", blocks: [{ type: "text", text: "第二句" }] }] },
	});

	assert.deepEqual(transition, { state }, "the wait set is not empty yet");
});

test("the agent does not answer a history whose last word is its own", () => {
	const config = agentConfigSchema.parse({ model: "m" });
	const step = (body: HistoryMessage[]) =>
		agent.step({
			self: "bot",
			config,
			state: agentStateSchema.parse(undefined),
			message: { type: HISTORY_PORT, body },
		});

	assert.equal(step([]).effects, undefined, "nothing said yet");
	assert.equal(step([textMessage("assistant", "我说过了")]).effects, undefined, "no reason to speak again");
	assert.equal(answerable([textMessage("assistant", "我说过了")]), false);
	const asked = step([textMessage("user", "你好")]);
	assert.equal(asked.effects?.length, 1, "a user word asks");
	const afterTool = step([textMessage("user", "查一下"), textMessage("tool", "12:00")]);
	assert.equal(afterTool.effects?.length, 1, "a tool result asks again");
});

test("words that arrive while the model is thinking are kept for the next call", async () => {
	const store = await setup();
	await say(store, "第一句");
	await run(store, registry, "w");

	await say(store, "第二句");
	await run(store, registry, "w");

	const waiting = await snapshot(store);
	assert.equal(waiting.inFlight.length, 1, "still the one call that is already out");

	const effect = waiting.inFlight[0];
	assert.ok(effect !== undefined);
	await completeEffect(store, "w", effect.effectId, answer({ type: "text", text: "都听到了" }));
	await run(store, registry, "w");

	const history = await historyOf(store);
	assert.deepEqual(
		history.map((message) => message.role),
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
	assert.deepEqual(Object.keys(ports).sort(), ["append", "history", "reply", TOOL_RESULT_PORT].sort());
	const withTool = agent.ports(
		agentConfigSchema.parse({
			model: "m",
			tools: [{ name: "plus_one", description: "", input: {} }],
		}),
	);
	assert.deepEqual(
		Object.keys(withTool).sort(),
		["append", "history", "reply", "tool.plus_one", TOOL_RESULT_PORT].sort(),
	);
});

test("state defaults make an agent usable from an empty template entry", () => {
	assert.deepEqual(agentStateSchema.parse(undefined), { pending: {}, nextCall: 0 });
	assert.deepEqual(conversationStateSchema.parse(undefined), { history: [] });
});

test("a v1 agent state (history on the node) cannot be migrated silently", () => {
	assert.throws(
		() => agent.migrate?.({ history: [], pending: {}, nextCall: 0 }, 1),
		/conversation/,
		"it halts instead of dropping the conversation (ADR-0008)",
	);
	assert.deepEqual(agent.migrate?.({ pending: {}, nextCall: 2 }, 1), { pending: {}, nextCall: 2 });
});

test("the model.complete kind is what the registry holds", () => {
	const registryWithKind: Registry = createRegistry({ nodes: [agent], effects: [modelCompleteKind] });
	assert.equal(registryWithKind.effectKind("model.complete")?.kind, "model.complete");
	assert.equal(
		registryWithKind.effectKind("model.complete")?.input.safeParse({ model: "m", messages: [] }).success,
		true,
	);
	assert.equal(registryWithKind.effectKind("model.complete")?.input.safeParse({ messages: [] }).success, false);
});

// ── judge：拿 history 先判一下，再决定交给 agent 还是自己回 ─────────────────

/**
 * 一个类 JEV 的判断节点：不存 history，只读 conversation 发来的快照。
 * 说「你好」就自己回固定话术，别的一律原样转给 agent。
 */
const judge = defineNode({
	name: "judge",
	version: 1,
	state: z.object({ judged: z.number() }).default({ judged: 0 }),
	config: z.null(),
	ports: () => ({
		[HISTORY_PORT]: historySchema,
		[APPEND_PORT]: historyMessageSchema,
		reply: z.object({ text: z.string(), message: historyMessageSchema }),
	}),
	step: ({ state, message }) => {
		if (message.type !== HISTORY_PORT) return { state };
		const history = historySchema.parse(message.body);
		if (!answerable(history)) return { state };
		const judged = { judged: state.judged + 1 };
		if (textOf(history.at(-1) as HistoryMessage) === "你好") {
			const message: HistoryMessage = { role: "assistant", blocks: [text("你好，我是 judge 的固定回复")] };
			return {
				state: judged,
				sends: [
					{ port: APPEND_PORT, body: message },
					{ port: "reply", body: { text: textOf(message), message } },
				],
			};
		}
		return { state: judged, sends: [{ port: HISTORY_PORT, body: history }] };
	},
});

const judgeTemplate: WorkflowTemplate = {
	nodes: { ...graphOf([]).nodes, judge: { definition: "judge", config: null } },
	edges: [
		...layout.edges,
		{ from: "chat", to: "judge", port: HISTORY_PORT },
		{ from: "judge", to: "bot", port: HISTORY_PORT },
		{ from: "bot", to: "chat", port: APPEND_PORT },
		{ from: "judge", to: "chat", port: APPEND_PORT },
		{ from: "bot", to: "out", port: "reply" },
		{ from: "judge", to: "out", port: "reply" },
	],
};

const judgeRegistry = createRegistry({
	nodes: [agent, conversation, judge, plusOne, recorder],
	effects: [modelCompleteKind],
});

test("the judge answers a greeting itself, without a model call", async () => {
	const store = createMemoryStore();
	await createWorkflow(store, judgeRegistry, judgeTemplate, { id: "w" });
	await say(store, "你好");
	const s = await play(store, [], "w", judgeRegistry);

	assert.equal(s.halted, undefined);
	assert.deepEqual(
		(await historyOf(store)).map((message) => message.role),
		["user", "assistant"],
		"the fixed reply is recorded too",
	);
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["你好，我是 judge 的固定回复"]);
	assert.equal((s.graph.nodeStates.judge?.state as { judged: number }).judged, 1);
});

test("the judge hands anything else to the agent, which then answers", async () => {
	const store = createMemoryStore();
	await createWorkflow(store, judgeRegistry, judgeTemplate, { id: "w" });
	await say(store, "42 加一是几");

	// judge 不出模型调用，效果只有 agent 那一次。
	const s = await play(store, [answer({ type: "text", text: "是 43" })], "w", judgeRegistry);

	assert.equal(s.halted, undefined);
	assert.deepEqual(
		(await historyOf(store)).map((message) => message.role),
		["user", "assistant"],
	);
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["是 43"]);
	assert.equal((s.graph.nodeStates.judge?.state as { judged: number }).judged, 1);
});
