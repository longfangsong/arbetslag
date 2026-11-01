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
	APPEND_PORT,
	type LlmConfig,
	type LlmState,
	CONVERSATION_NAME,
	HISTORY_PORT,
	TOOL_RESULT_PORT,
	llm,
	llmConfigSchema,
	wireTools,
	llmStateSchema,
	INBOX_NAME,
	USER_PORT,
	answerable,
	conversation,
	forModel,
	inbox,
	unanswered,
	conversationStateSchema,
	NotAToolProvider,
	defineTool,
	historySchema,
	provideTools,
	toolResultBlockSchema,
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

const layout = wireTools({
	llm: "bot",
	config: { model: "fake-1", system: "你是个助手" },
	tools: [{ node: plusOne }],
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
	nodes: [llm, conversation, plusOne, recorder],
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

const llmStateOf = async (store: SnapshotStore): Promise<LlmState> => {
	const s = await snapshot(store);
	return s.graph.nodeStates.bot?.state as LlmState;
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
			assert.ok(reply !== undefined, "the llm node asked more often than scripted");
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
	assert.equal((await llmStateOf(store)).modelCall, "m1");
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
	assert.equal((await llmStateOf(store)).modelCall, undefined);
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
	assert.deepEqual((await llmStateOf(store)).pending, {}, "the wait set is empty again");
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["是 42"]);
	assert.deepEqual((s.graph.nodeStates["bot.plus_one"]?.state as { calls: number }).calls, 1);
});

test("a tool the llm node has no port for becomes a failed tool result, not a crash", async () => {
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

test("a failed model call is answered as text, and the llm node stays usable", async () => {
	const store = await setup();
	await say(store, "你好");
	const s = await play(store, [{ ok: false, error: "rate limited" }]);

	assert.equal(s.halted, undefined);
	const out = s.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.match(out.replies[0]?.text ?? "", /rate limited/);
	assert.equal((await llmStateOf(store)).modelCall, undefined);
	assert.deepEqual(
		(await historyOf(store)).map((message) => message.role),
		["user", "assistant"],
		"the failure is part of the record too",
	);
});

test("a receipt for another call is ignored", () => {
	const state = llmStateSchema.parse({ modelCall: "m2" });
	const transition = llm.step({
		self: "bot",
		config: llmConfigSchema.parse({ model: "m" }),
		state,
		message: {
			type: "@effect.end",
			body: { correlationId: "m1", result: { ok: true, message: textMessage("assistant", "假的") } },
		},
	});

	assert.deepEqual(transition, { state }, "another call's receipt changes nothing");
});

test("a history snapshot arrives while a tool call is in flight: no second model call", () => {
	const state = llmStateSchema.parse({ pending: { c1: "plus_one" }, nextCall: 3 });
	const transition = llm.step({
		self: "bot",
		config: llmConfigSchema.parse({ model: "m" }),
		state,
		message: { type: HISTORY_PORT, body: [{ role: "user", blocks: [{ type: "text", text: "第二句" }] }] },
	});

	assert.deepEqual(transition, { state }, "the wait set is not empty yet");
});

test("the llm node does not answer a history whose last word is its own", () => {
	const config = llmConfigSchema.parse({ model: "m" });
	const step = (body: HistoryMessage[]) =>
		llm.step({
			self: "bot",
			config,
			state: llmStateSchema.parse(undefined),
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

test("words that arrive while the model is thinking are answered in one more call", async () => {
	const store = await setup();
	await say(store, "第一句");
	await run(store, registry, "w");

	await say(store, "第二句");
	await say(store, "第三句");
	await run(store, registry, "w");

	const waiting = await snapshot(store);
	assert.equal(waiting.inFlight.length, 1, "still the one call that is already out");

	await play(store, [answer({ type: "text", text: "答第一句" }), answer({ type: "text", text: "答二三句" })]);

	const history = await historyOf(store);
	assert.deepEqual(
		history.map((message) => message.role),
		["user", "user", "user", "assistant", "assistant"],
		"the words are recorded when they arrived, before the first answer",
	);
	const out = (await snapshot(store)).graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(
		out.replies.map((reply) => reply.text),
		["答第一句", "答二三句"],
		"nothing said while thinking is left unanswered",
	);
	assert.equal((await llmStateOf(store)).seen, 4, "the second call saw everything up to the first answer");
});

test("an inbox in front of the conversation makes the llm node answer one word at a time", async () => {
	const queued: WorkflowTemplate = {
		nodes: {
			...layout.nodes,
			inbox: { definition: INBOX_NAME, config: null },
			chat: { definition: CONVERSATION_NAME, config: null },
			out: { definition: "recorder", config: null },
		},
		edges: [
			...layout.edges,
			{ from: "inbox", to: "chat", port: USER_PORT },
			{ from: "chat", to: "inbox", port: HISTORY_PORT },
			{ from: "chat", to: "bot", port: HISTORY_PORT },
			{ from: "bot", to: "chat", port: APPEND_PORT },
			{ from: "bot", to: "out", port: "reply" },
		],
	};
	const reg = createRegistry({ nodes: [llm, conversation, inbox, plusOne, recorder], effects: [modelCompleteKind] });
	const store = createMemoryStore();
	await createWorkflow(store, reg, queued, { id: "q" });
	const tell = (text: string) => deliverToNode(store, "q", "inbox", { type: USER_PORT, body: { text } });

	await tell("一");
	await run(store, reg, "q");
	await tell("二");
	await tell("三");
	await run(store, reg, "q");

	const asked: string[][] = [];
	const settled = await (async () => {
		for (let round = 0; round < 20; round++) {
			await run(store, reg, "q");
			const s = await snapshot(store, "q");
			if (s.inFlight.length === 0) return s;
			for (const effect of s.inFlight) {
				const input = effect.input as { messages: HistoryMessage[] };
				asked.push(input.messages.filter((m) => m.role !== "system").map(textOf));
				const last = textOf(input.messages.at(-1) as HistoryMessage);
				await completeEffect(store, "q", effect.effectId, answer({ type: "text", text: `答${last}` }));
			}
		}
		throw new Error("never settled");
	})();

	const history = (settled.graph.nodeStates.chat?.state as { history: HistoryMessage[] }).history;
	assert.deepEqual(history.map(textOf), ["一", "答一", "二", "答二", "三", "答三"], "one word, one answer, in order");
	assert.deepEqual(asked, [["一"], ["一", "答一", "二"], ["一", "答一", "二", "答二", "三"]]);
	const out = settled.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["答一", "答二", "答三"]);
	assert.deepEqual(settled.graph.nodeStates.inbox?.state, { busy: false, queue: [] });
});

test("the model sees a tool call followed by its results, even if a user spoke in between", () => {
	const call = { type: "tool-call" as const, callId: "c1", name: "plus_one", input: { n: 1 } };
	const history: HistoryMessage[] = [
		textMessage("user", "加一"),
		{ role: "assistant", blocks: [call] },
		textMessage("user", "顺便问一句"),
		{ role: "tool", blocks: [{ type: "tool-result", callId: "c1", name: "plus_one", ok: true, result: { n: 2 } }] },
	];
	assert.deepEqual(
		forModel(history).map((message) => message.role),
		["user", "assistant", "tool", "user"],
	);
	assert.deepEqual(forModel(history.slice(0, 3)).map((m) => m.role), ["user", "assistant", "user"], "unclosed: kept");
	assert.equal(unanswered(history, 2), true);
	assert.equal(unanswered([...history, textMessage("assistant", "2")], 4), false);
});

test("wireTools copies tool descriptions and wires both directions", () => {
	assert.deepEqual(layout.edges, [
		{ from: "bot", to: "bot.plus_one", port: "tool.plus_one" },
		{ from: "bot.plus_one", to: "bot", port: TOOL_RESULT_PORT },
	]);
	const config = layout.nodes.bot?.config as LlmConfig;
	assert.equal(config.model, "fake-1");
	assert.deepEqual(
		config.tools.map((tool) => tool.name),
		["plus_one"],
	);
	assert.deepEqual(Object.keys(layout.nodes), ["bot", "bot.plus_one"]);
	assert.equal(layout.nodes["bot.plus_one"]?.definition, "plus_one");
});

test("the llm node's ports are a function of its tool list", () => {
	const ports = llm.ports(llmConfigSchema.parse({ model: "m", tools: [] }));
	assert.deepEqual(Object.keys(ports).sort(), ["append", "history", "reply", TOOL_RESULT_PORT].sort());
	const withTool = llm.ports(
		llmConfigSchema.parse({
			model: "m",
			tools: [{ name: "plus_one", description: "", input: {} }],
		}),
	);
	assert.deepEqual(
		Object.keys(withTool).sort(),
		["append", "history", "reply", "tool.plus_one", TOOL_RESULT_PORT].sort(),
	);
});

test("state defaults make an llm node usable from an empty template entry", () => {
	assert.deepEqual(llmStateSchema.parse(undefined), { pending: {}, nextCall: 0 });
	assert.deepEqual(conversationStateSchema.parse(undefined), { history: [] });
});

test("the model.complete kind is what the registry holds", () => {
	const registryWithKind: Registry = createRegistry({ nodes: [llm], effects: [modelCompleteKind] });
	assert.equal(registryWithKind.effectKind("model.complete")?.kind, "model.complete");
	assert.equal(
		registryWithKind.effectKind("model.complete")?.input.safeParse({ model: "m", messages: [] }).success,
		true,
	);
	assert.equal(registryWithKind.effectKind("model.complete")?.input.safeParse({ messages: [] }).success, false);
});

// ── judge：拿 history 先判一下，再决定交给 LLM 节点还是自己回 ─────────────────

/**
 * 一个类 JEV 的判断节点：不存 history，只读 conversation 发来的快照。
 * 说「你好」就自己回固定话术，别的一律原样转给 LLM 节点。
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
	nodes: [llm, conversation, judge, plusOne, recorder],
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

test("the judge hands anything else to the llm node, which then answers", async () => {
	const store = createMemoryStore();
	await createWorkflow(store, judgeRegistry, judgeTemplate, { id: "w" });
	await say(store, "42 加一是几");

	// judge 不出模型调用，效果只有 LLM 节点那一次。
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

// ── 工具是节点提供的东西，不是一类节点（ADR-0009）──────────────────────────

/** 一份普通节点定义：被调用时交出一个效果，等回执回来再回结果。工具名由 config 决定。 */
const lookup = provideTools(
	defineNode({
		name: "lookup",
		version: 1,
		state: z.null().default(null),
		config: z.object({ tool: z.string() }),
		ports: () => ({ [TOOL_RESULT_PORT]: toolResultBlockSchema }),
		step: ({ state, config, message }) => {
			if (message.type === `tool.${config.tool}`) {
				const call = message.body as { callId: string; input: { key: string } };
				return { state, effects: [{ kind: "db.get", input: { key: call.input.key }, correlationId: call.callId }] };
			}
			if (message.type === "@effect.end") {
				const end = message.body as { correlationId: string; result: JsonValue };
				const result = { type: "tool-result", callId: end.correlationId, name: config.tool, ok: true, result: end.result };
				return { state, sends: [{ port: TOOL_RESULT_PORT, body: result }] };
			}
			return { state };
		},
	}),
	(config) => [{ name: config.tool, description: "按 key 查一条记录", input: z.object({ key: z.string() }) }],
);

const dbGetKind = { kind: "db.get", input: z.object({ key: z.string() }), result: anyJson };

test("a plain node that provides a tool is called by the llm node and answers through an effect", async () => {
	const wired = wireTools({ llm: "bot", config: { model: "fake-1" }, tools: [{ node: lookup, config: { tool: "find" } }] });
	assert.deepEqual(
		(wired.nodes.bot?.config as LlmConfig).tools.map((tool) => tool.name),
		["find"],
		"the tool's name comes from the provider's config",
	);
	const reg = createRegistry({ nodes: [llm, conversation, lookup, recorder], effects: [modelCompleteKind, dbGetKind] });
	const store = createMemoryStore();
	await createWorkflow(
		store,
		reg,
		{
			nodes: { ...wired.nodes, chat: { definition: CONVERSATION_NAME, config: null }, out: { definition: "recorder", config: null } },
			edges: [
				...wired.edges,
				{ from: "chat", to: "bot", port: HISTORY_PORT },
				{ from: "bot", to: "chat", port: APPEND_PORT },
				{ from: "bot", to: "out", port: "reply" },
			],
		},
		{ id: "p" },
	);
	await deliverToNode(store, "p", "chat", { type: USER_PORT, body: { text: "查一下 a" } });

	const settled = await play(
		store,
		[
			answer({ type: "tool-call", callId: "c1", name: "find", input: { key: "a" } }),
			{ value: 42 },
			answer({ type: "text", text: "a 是 42" }),
		],
		"p",
		reg,
	);

	const history = (settled.graph.nodeStates.chat?.state as { history: HistoryMessage[] }).history;
	assert.deepEqual(history.map((message) => message.role), ["user", "assistant", "tool", "assistant"]);
	assert.deepEqual(history[2]?.blocks[0], {
		type: "tool-result",
		callId: "c1",
		name: "find",
		ok: true,
		result: { value: 42 },
	});
	const out = settled.graph.nodeStates.out?.state as { replies: { text: string }[] };
	assert.deepEqual(out.replies.map((reply) => reply.text), ["a 是 42"]);
});

test("wireTools refuses a node that provides no tools, or has nowhere to answer", () => {
	assert.throws(() => wireTools({ llm: "bot", config: { model: "m" }, tools: [{ node: recorder as never }] }), NotAToolProvider);

	const mute = provideTools(
		defineNode({
			name: "mute",
			version: 1,
			state: z.null().default(null),
			config: z.null(),
			ports: () => ({}),
			step: ({ state }) => ({ state }),
		}),
		() => [{ name: "mute", description: "", input: z.object({}) }],
	);
	assert.throws(() => wireTools({ llm: "bot", config: { model: "m" }, tools: [{ node: mute }] }), /tool\.result/);

	assert.throws(
		() =>
			wireTools({
				llm: "bot",
				config: { model: "m" },
				tools: [
					{ node: lookup, config: { tool: "find" }, id: "a" },
					{ node: lookup, config: { tool: "find" }, id: "b" },
				],
			}),
		/provided twice/,
	);
});
