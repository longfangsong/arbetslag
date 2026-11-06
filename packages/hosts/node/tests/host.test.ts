import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import {
	type LogEntry,
	type TransitionLog,
	type WorkflowTemplate,
	createRegistry,
	InstantiateError,
	WorkflowExists,
	createWorkflow,
	defineMatcher,
	defineNode,
} from "@arbetslag/kernel";
import type { Performers } from "../src/executor.ts";
import { type Host, type HostChange, type HostOptions, type Unready, createHost } from "../src/host.ts";
import type { ListenerRuntime } from "../src/listeners/runtime.ts";
import { chatIs } from "../src/matchers.ts";
import { type SqliteStore, createSqliteStore } from "../src/sqliteStore.ts";

const anyJson: z.ZodType<JsonValue> = z.json();

/** 收到 `go` 交出一个 `slow.call`；回执与别的消息都记下来。 */
const worker = defineNode({
	name: "worker",
	version: 1,
	state: z.object({ got: z.array(anyJson) }).default({ got: [] }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type === "go") {
			return {
				state,
				effects: [{ kind: "slow.call", input: message.body, correlationId: `c${String(state.got.length)}` }],
			};
		}
		if (message.type === "drop-trigger") {
			const ops: JsonValue[] = [{ op: "removeTrigger", id: "in" }];
			return { state, effects: [{ kind: "graph.mutate", input: { ops }, correlationId: "m" }] };
		}
		return { state: { got: [...state.got, { type: message.type, body: message.body }] } };
	},
});

/** 总机（ADR-0015）：没人认领的消息 → 为这个 chat 起一份工作流，并把这条消息转交过去。 */
const switchboard = defineNode({
	name: "switchboard",
	version: 1,
	state: z.object({ receipts: z.array(anyJson) }).default({ receipts: [] }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type === "text") {
			const body = message.body as { chatId: number; text: string; id: string };
			return {
				state,
				effects: [
					{
						kind: "workflow.spawn",
						input: {
							id: `chat:${body.chatId}`,
							template: "chat",
							params: { chatId: body.chatId },
							forward: { trigger: "in", output: "text", body, eventId: body.id },
						},
					},
				],
			};
		}
		return { state: { receipts: [...state.receipts, message.body] } };
	},
});

/** 一轮对话的骨架（ADR-0016）：`text` → 想一想（可重放）→ 说出来（不可重放）→ 记下说了什么。 */
const bot = defineNode({
	name: "bot",
	version: 1,
	state: z.object({ said: z.array(anyJson) }).default({ said: [] }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type === "text") {
			return { state, effects: [{ kind: "think.call", input: message.body, correlationId: "think" }] };
		}
		if (message.type === "@effect.end") {
			const body = message.body as { correlationId?: string; result: JsonValue };
			if (body.correlationId === "think") {
				return { state, effects: [{ kind: "say.call", input: body.result, correlationId: "say" }] };
			}
			return { state: { said: [...state.said, body.result] } };
		}
		return { state };
	},
});

/** 收到 `spawn` 就把 body 当 `workflow.spawn` 的 input 交出去。 */
const spawner = defineNode({
	name: "spawner",
	version: 1,
	state: z.null().default(null),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) =>
		message.type === "spawn"
			? { state, effects: [{ kind: "workflow.spawn", input: message.body, correlationId: "spawn" }] }
			: { state },
});

const boom = defineMatcher({
	name: "boom",
	config: z.unknown(),
	match: () => {
		throw new Error("matcher exploded");
	},
});

const registry = createRegistry({
	nodes: [worker, switchboard, bot, spawner],
	effects: [
		{ kind: "slow.call", input: anyJson, result: anyJson },
		{ kind: "think.call", input: anyJson, result: anyJson, replayable: true },
		{ kind: "say.call", input: anyJson, result: anyJson },
	],
	triggers: [{ kind: "hook", config: z.object({}), outputs: () => ({ text: anyJson }) }],
	matchers: [chatIs, boom],
});

const one: WorkflowTemplate = { nodes: { w: { definition: "worker", config: null } } };

/** 订阅监听器 `l` 的一份工作流：触发器 `in` 接到节点 `w`。 */
const subscriber = (trigger: Record<string, JsonValue> = {}): WorkflowTemplate => ({
	nodes: { w: { definition: "worker", config: null } },
	triggers: [{ id: "in", kind: "hook", listener: "l", ...trigger }],
	edges: [{ from: "in", to: "w", port: "text" }],
});

/** 订阅监听器 `l` 的一个 bot。 */
const botSubscriber: WorkflowTemplate = {
	nodes: { b: { definition: "bot", config: null } },
	triggers: [{ id: "in", kind: "hook", listener: "l" }],
	edges: [{ from: "in", to: "b", port: "text" }],
};

/** 一个 chat 一份的会话工作流：按参数 `chatId` 只订阅那个 chat（ADR-0018）。 */
const chatTemplate: WorkflowTemplate = {
	params: { chatId: 0 },
	...subscriber({ match: { fn: "chatIs", config: { chatId: "{{chatId}}" } } }),
};

/** 一个可控的 Performer：每次调用挂住，直到测试放行；记下每个 `effectId` 被交出几次。 */
function gate(kind = "slow.call") {
	const calls = new Map<string, number>();
	const waiting: (() => void)[] = [];
	const performers: Performers = {
		[kind]: async (input, { effect }) => {
			calls.set(effect.effectId, (calls.get(effect.effectId) ?? 0) + 1);
			await new Promise<void>((resolve) => waiting.push(resolve));
			return { ok: true, input };
		},
	};
	return {
		performers,
		calls,
		pending: () => waiting.length,
		release: () => {
			for (const resolve of waiting.splice(0)) resolve();
		},
	};
}

const instant: Performers = { "slow.call": async (input) => ({ ok: true, input }) };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check: () => boolean, ms = 1000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}

function setup(options: Partial<HostOptions> = {}) {
	const store = createSqliteStore({ file: ":memory:" });
	const errors: unknown[] = [];
	const unready: Unready[] = [];
	const host = createHost({
		store,
		registry,
		performers: instant,
		templates: { chat: chatTemplate },
		listeners: [{ id: "l", kind: "hook", config: {} }],
		onError: (info) => errors.push(info.error),
		onUnready: (info) => unready.push(info),
		...options,
	});
	return { store, host, errors, unready };
}

async function got(host: Host, id: string): Promise<JsonValue[]> {
	const loaded = await host.snapshot(id);
	return (loaded?.graph.nodeStates.w?.state as { got: JsonValue[] } | undefined)?.got ?? [];
}

const texts = async (host: Host, id: string) =>
	(await got(host, id)).flatMap((entry) => {
		const e = entry as { type: string; body: { text?: string } };
		return e.type === "text" ? [e.body.text] : [];
	});

// ── ADR-0014：一个激活，交出至多一次 ──────────────────────────────────────────

test("submit returns once the effect is handed out; the receipt lands in the background", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, one, { id: "a" });

	const advanced = await host.submit("a", "w", { type: "go", body: { n: 1 } });
	assert.deepEqual(advanced, { status: "quiescent", rounds: 1, steps: 1, dispatched: 1 });

	await host.idle();
	const [receipt] = await got(host, "a");
	assert.deepEqual(receipt, { type: "@effect.end", body: { correlationId: "c0", result: { ok: true, input: { n: 1 } } } });
	assert.deepEqual(host.executing("a"), []);
});

test("while the model is thinking, a new message is delivered and run at once", async () => {
	const performer = gate();
	const { store, host } = setup({ performers: performer.performers });
	await createWorkflow(store, registry, one, { id: "a" });

	await host.submit("a", "w", { type: "go", body: { n: 1 } });
	await until(() => performer.pending() === 1);
	// 第一个效果还挂着：新消息不该排在它后面。
	await host.submit("a", "w", { type: "note", body: "hi" });
	assert.deepEqual(await got(host, "a"), [{ type: "note", body: "hi" }]);

	performer.release();
	await host.idle();
	assert.equal((await got(host, "a")).length, 2);
});

test("within one activation an effect is handed out at most once, however often the workflow is pushed", async () => {
	const performer = gate();
	const { store, host } = setup({ performers: performer.performers });
	await createWorkflow(store, registry, one, { id: "a" });

	await host.submit("a", "w", { type: "go", body: null });
	await until(() => performer.pending() === 1);
	const [effectId] = host.executing("a");
	assert.ok(effectId !== undefined);

	await Promise.all([
		host.drive("a"),
		host.drain("a"),
		host.submit("a", "w", { type: "note", body: 1 }),
		host.submit("a", "w", { type: "note", body: 2 }),
	]);
	assert.equal(performer.calls.get(effectId), 1);

	performer.release();
	await host.idle();
	assert.equal(performer.calls.get(effectId), 1);
});

test("a new activation on the same store hands the stuck effect out exactly once more", async () => {
	const performer = gate();
	const first = setup({ performers: performer.performers });
	await createWorkflow(first.store, registry, one, { id: "a" });
	await first.host.submit("a", "w", { type: "go", body: null });
	await until(() => performer.pending() === 1);
	const [effectId] = first.host.executing("a");
	assert.ok(effectId !== undefined);

	// 「进程重启」：同一份存储上的另一个激活。旧激活的认领随它一起作废。
	const second = createHost({ store: first.store, registry, performers: performer.performers });
	const report = await second.recover();
	assert.equal(report.redispatched, 1);
	await until(() => performer.calls.get(effectId) === 2);

	await second.drive("a");
	await second.recover();
	assert.equal(performer.calls.get(effectId), 2, "the same activation does not re-hand it out, not even on a rescan");

	performer.release();
	await Promise.all([first.host.idle(), second.idle()]);
	const receipts = (await got(second, "a")).filter((e) => (e as { type: string }).type === "@effect.end");
	assert.equal(receipts.length, 1, "the graph still sees exactly one receipt");
});

test("a performer that never answers times out into a failure receipt", async () => {
	const { store, host } = setup({
		performers: { "slow.call": () => new Promise(() => {}) },
		timeouts: { "slow.call": 20 },
	});
	await createWorkflow(store, registry, one, { id: "a" });

	await host.submit("a", "w", { type: "go", body: null });
	await host.idle();
	const [receipt] = await got(host, "a");
	assert.deepEqual(receipt, {
		type: "@effect.end",
		body: { correlationId: "c0", result: { ok: false, error: 'effect "slow.call" timed out after 20ms' } },
	});
	assert.equal((await store.load("a"))?.inFlight.length, 0);
	assert.deepEqual(host.executing("a"), []);
});

test("a missing performer is reported, not a halt: the record stays for the next deployment", async () => {
	const { store, host, errors } = setup({ performers: {} });
	await createWorkflow(store, registry, one, { id: "a" });

	await host.submit("a", "w", { type: "go", body: null });
	assert.match(String(errors[0]), /no performer for effect kind "slow.call"/);
	const loaded = await store.load("a");
	assert.equal(loaded?.halted, undefined);
	assert.equal(loaded?.inFlight.length, 1);
});

test("graph.mutate runs inside the push, and the route index follows the new shape", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, subscriber(), { id: "a" });
	await host.recover();
	assert.deepEqual((await store.subscriptions("l")).map((s) => s.workflowId), ["a"]);

	await host.submit("a", "w", { type: "drop-trigger", body: null });
	assert.deepEqual(await store.subscriptions("l"), [], "the trigger is gone, so is its subscription");
});

// ── ADR-0015：监听器、订阅、路由 ───────────────────────────────────────────────

test("an event goes to every subscriber in the top layer of each group", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, subscriber(), { id: "a" });
	await createWorkflow(store, registry, subscriber(), { id: "b" });
	await createWorkflow(store, registry, subscriber({ priority: -1 }), { id: "fallback" });
	await createWorkflow(store, registry, subscriber({ group: "audit" }), { id: "audit" });
	await host.recover();

	const routed = await host.emit("l", { output: "text", body: { text: "hi" } });
	assert.deepEqual(routed, { targets: ["a", "audit", "b"], enqueued: 3 });
	await host.idle();
	for (const id of ["a", "b", "audit"]) assert.deepEqual(await texts(host, id), ["hi"], id);
	assert.deepEqual(await texts(host, "fallback"), []);
});

test("the source retrying the same event id does not deliver twice", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, subscriber(), { id: "a" });
	await host.recover();

	const event = { output: "text", body: { text: "once" }, eventId: "update-7" };
	assert.equal((await host.emit("l", event)).enqueued, 1);
	assert.equal((await host.emit("l", event)).enqueued, 0);
	await host.idle();
	assert.deepEqual(await texts(host, "a"), ["once"]);
});

test("draining again after a crash delivers nothing twice (the cursor moved with the snapshot)", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, subscriber(), { id: "a" });
	await host.recover();
	await host.emit("l", { output: "text", body: { text: "one" } });
	await host.idle();

	const restarted = createHost({ store, registry, performers: instant, listeners: [{ id: "l", kind: "hook", config: {} }] });
	await restarted.recover();
	await restarted.drain("a");
	assert.deepEqual(await texts(restarted, "a"), ["one"]);
});

test("a halted workflow leaves its events in the outbox; resume delivers them in order", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, subscriber(), { id: "a" });
	await host.recover();
	await store.commit("a", (snapshot) => ({
		snapshot: { ...snapshot, halted: { code: "step_threw", detail: "test", at: new Date(0).toISOString() } },
		value: undefined,
	}));

	await host.emit("l", { output: "text", body: { text: "first" } });
	await host.emit("l", { output: "text", body: { text: "second" } });
	await host.idle();
	assert.deepEqual(await texts(host, "a"), []);
	assert.deepEqual(await store.pendingTargets(), ["a"]);

	assert.equal(await host.resume("a"), true);
	await host.idle();
	assert.deepEqual(await texts(host, "a"), ["first", "second"]);
	assert.deepEqual(await store.pendingTargets(), []);
});

test("the switchboard starts one workflow per chat; later messages skip it and keep their order", async () => {
	const { store, host } = setup();
	await createWorkflow(
		store,
		registry,
		{
			nodes: { s: { definition: "switchboard", config: null } },
			triggers: [{ id: "in", kind: "hook", listener: "l", priority: -1 }],
			edges: [{ from: "in", to: "s", port: "text" }],
		},
		{ id: "switchboard" },
	);
	await host.recover();

	const say = (chatId: number, text: string, id: string) =>
		host.emit("l", { output: "text", body: { chatId, text, id }, eventId: id });

	assert.deepEqual((await say(1, "hello from 1", "e1")).targets, ["switchboard"]);
	await host.idle();
	assert.deepEqual((await say(2, "hello from 2", "e2")).targets, ["switchboard"]);
	await host.idle();
	assert.deepEqual(await store.ids(), ["chat:1", "chat:2", "switchboard"]);

	assert.deepEqual((await say(1, "again", "e3")).targets, ["chat:1"], "the chat's own subscription claims it now");
	await host.idle();
	assert.deepEqual(await texts(host, "chat:1"), ["hello from 1", "again"]);
	assert.deepEqual(await texts(host, "chat:2"), ["hello from 2"]);

	const receipts = (await host.store.load("switchboard"))?.graph.nodeStates.s?.state as { receipts: JsonValue[] };
	assert.deepEqual(
		receipts.receipts.map((r) => (r as { result: JsonValue }).result),
		[
			{ ok: true, created: true },
			{ ok: true, created: true },
		],
	);
});

test("a matcher that throws counts as no match and is reported; the others still get the event", async () => {
	const { store, host, errors } = setup();
	await createWorkflow(store, registry, subscriber({ match: { fn: "boom" } }), { id: "bad" });
	await createWorkflow(store, registry, subscriber(), { id: "good" });
	await host.recover();

	assert.deepEqual((await host.emit("l", { output: "text", body: { text: "x" } })).targets, ["good"]);
	assert.match(String(errors[0]), /matcher exploded/);
});

test("a trigger on a listener this deployment does not have is unready, not a halt", async () => {
	const { store, host, unready } = setup();
	await createWorkflow(
		store,
		registry,
		{ ...subscriber(), triggers: [{ id: "in", kind: "hook", listener: "elsewhere" }] },
		{ id: "a" },
	);
	await host.recover();
	assert.deepEqual(unready, [
		{ scope: "trigger", workflowId: "a", trigger: "in", reason: 'no listener "elsewhere" in this deployment' },
	]);
	assert.equal((await store.load("a"))?.halted, undefined);
});

test("a row whose trigger was removed after routing is dropped and logged, the rest still go in", async () => {
	const entries: LogEntry[] = [];
	const log: TransitionLog = { append: (_id, batch) => void entries.push(...batch) };
	const { store, host } = setup({ log });
	await createWorkflow(store, registry, subscriber(), { id: "a" });
	await store.enqueue([
		{ target: "a", trigger: "gone", output: "text", body: { text: "lost" }, listener: "l" },
		{ target: "a", trigger: "in", output: "text", body: { text: "kept" }, listener: "l" },
	]);

	await host.drain("a");
	assert.deepEqual(await texts(host, "a"), ["kept"]);
	assert.ok(entries.some((e) => e.type === "dropped" && e.reason === "rejected" && e.from === "gone"));
});

test("start opens the declared listeners; an emit through the runtime reaches the workflow", async () => {
	let emit: ((text: string) => Promise<unknown>) | undefined;
	let closed = 0;
	const runtime: ListenerRuntime = {
		kind: "hook",
		open: async (_listener, hooks) => {
			emit = (text) => hooks.emit({ output: "text", body: { text } });
			return { close: async () => void closed++ };
		},
	};
	const { store, host } = setup({ runtimes: { hook: runtime } });
	await createWorkflow(store, registry, subscriber(), { id: "a" });

	await host.start();
	assert.ok(emit !== undefined);
	await emit("via listener");
	await host.idle();
	assert.deepEqual(await texts(host, "a"), ["via listener"]);

	await host.stop();
	assert.equal(closed, 1);
});

test("a listener that cannot open is unready and retried, without touching any workflow", async () => {
	let attempts = 0;
	const runtime: ListenerRuntime = {
		kind: "hook",
		open: async () => {
			attempts++;
			if (attempts < 3) throw new Error("port in use");
			return { close: async () => {} };
		},
	};
	const { host, unready } = setup({ runtimes: { hook: runtime }, retryMs: 5 });
	await host.start();
	await until(() => attempts === 3);
	await tick();
	assert.deepEqual(unready, [{ scope: "listener", listener: "l", reason: "port in use" }]);
	assert.deepEqual(host.unready(), []);
	await host.stop();
});

// ── ADR-0016：落盘只在三个时刻 ───────────────────────────────────────────────

/** 记下存储上每一次写：发件箱、检查点、路由索引。 */
function spyWrites(store: SqliteStore, writes: string[]): void {
	const { enqueue, checkpoint, replaceSubscriptions } = store;
	store.enqueue = (entries) => (writes.push("enqueue"), enqueue(entries));
	store.checkpoint = (id, c) => (writes.push("checkpoint"), checkpoint(id, c));
	store.replaceSubscriptions = (id, rows) => (writes.push("index"), replaceSubscriptions(id, rows));
}

test("one turn writes three times: the outbox row, before the reply goes out, once idle", async () => {
	const writes: string[] = [];
	const box: { store?: SqliteStore } = {};
	const { store, host } = setup({
		performers: {
			"think.call": async (input) => ({ answer: input }),
			"say.call": async (_input, { workflowId, effect }) => {
				const saved = await box.store?.load(workflowId);
				writes.push(saved?.inFlight.some((e) => e.effectId === effect.effectId) ? "say (saved)" : "say (unsaved)");
				return null;
			},
		},
	});
	box.store = store;
	await createWorkflow(store, registry, botSubscriber, { id: "a" });
	await host.recover();

	spyWrites(store, writes);
	await host.emit("l", { output: "text", body: { text: "hi" } });
	await host.idle();

	assert.deepEqual(writes, ["enqueue", "checkpoint", "say (saved)", "checkpoint"]);
	assert.deepEqual((await store.load("a"))?.graph.nodeStates.b?.state, { said: [null] });
	assert.deepEqual(await store.pendingTargets(), [], "the cursor went down with the last checkpoint");
});

test("handing out a replayable effect leaves the store alone", async () => {
	const think = gate("think.call");
	const { store, host } = setup({ performers: think.performers });
	await createWorkflow(store, registry, botSubscriber, { id: "a" });
	await host.recover();

	await host.emit("l", { output: "text", body: { text: "hi" } });
	await until(() => think.pending() === 1);
	assert.equal((await store.load("a"))?.inFlight.length, 0, "the store still holds the last checkpoint");
	assert.deepEqual(await store.pendingTargets(), ["a"], "the row is not consumed on disk yet");
	assert.equal((await host.snapshot("a"))?.inFlight.length, 1, "the working copy is ahead");

	think.release();
	await host.idle();
});

test("a crash before any checkpoint rewinds to the last one: the replay hands out the same effectId", async () => {
	const think = gate("think.call");
	const listeners = [{ id: "l", kind: "hook", config: {} }];
	const first = setup({ performers: think.performers });
	await createWorkflow(first.store, registry, botSubscriber, { id: "a" });
	await first.host.recover();
	await first.host.emit("l", { output: "text", body: { text: "hi" } });
	await until(() => think.pending() === 1);
	const [effectId] = first.host.executing("a");
	assert.equal(effectId, "0.0");

	// 「进程重启」：工作副本没了，从上一个检查点 + 发件箱重放。
	const second = createHost({ store: first.store, registry, performers: think.performers, listeners });
	await second.recover();
	await until(() => think.calls.get("0.0") === 2);

	think.release();
	await Promise.all([first.host.idle(), second.idle()]);
});

test("an ordinary push does not touch the route index; a trigger change does, inside its checkpoint", async () => {
	const writes: string[] = [];
	const { store, host } = setup();
	await createWorkflow(store, registry, subscriber(), { id: "a" });
	await host.recover();

	spyWrites(store, writes);
	await host.submit("a", "w", { type: "note", body: 1 });
	assert.deepEqual(writes, ["checkpoint"]);

	await host.submit("a", "w", { type: "drop-trigger", body: null });
	assert.deepEqual(writes, ["checkpoint", "checkpoint"]);
	assert.deepEqual(await store.subscriptions("l"), []);
});

// ── 给观察者的：创建与变化（ADR-0017） ─────────────────────────────────────────

test("create lands the snapshot and its subscriptions together: an event reaches it without a recover", async () => {
	const { store, host } = setup();
	await host.start();
	const { id } = await host.create(subscriber(), { id: "a" });
	assert.equal(id, "a");
	assert.deepEqual(
		(await store.subscriptions("l")).map((row) => row.workflowId),
		["a"],
	);

	await host.emit("l", { output: "text", body: { text: "hi" } });
	await host.idle();
	assert.deepEqual(await texts(host, "a"), ["hi"]);
	await host.stop();
});

test("create refuses an existing id and an invalid template, and writes nothing for either", async () => {
	const { store, host } = setup();
	await host.create(one, { id: "a" });
	await assert.rejects(host.create(subscriber(), { id: "a" }), WorkflowExists);
	assert.deepEqual(await store.subscriptions("l"), []);

	await assert.rejects(host.create({ nodes: { x: { definition: "nope", config: null } } }, { id: "b" }), InstantiateError);
	assert.deepEqual(await store.ids(), ["a"]);
});

test("create without an id picks one", async () => {
	const { store, host } = setup();
	const { id } = await host.create(one);
	assert.deepEqual(await store.ids(), [id]);
});

test("create reports a trigger on a missing listener as unready", async () => {
	const { host } = setup();
	const changes: HostChange[] = [];
	host.watch((change) => changes.push(change));
	await host.create({ ...subscriber(), triggers: [{ id: "in", kind: "hook", listener: "elsewhere" }] }, { id: "a" });
	assert.deepEqual(host.unready(), [
		{ scope: "trigger", workflowId: "a", trigger: "in", reason: 'no listener "elsewhere" in this deployment' },
	]);
	assert.ok(changes.some((change) => change.scope === "unready"));
});

test("spawn reports a trigger on a missing listener as unready, without waiting for a recover", async () => {
	const elsewhere: WorkflowTemplate = { ...subscriber(), triggers: [{ id: "in", kind: "hook", listener: "elsewhere" }] };
	const { store, host, unready } = setup({ templates: { elsewhere } });
	await createWorkflow(store, registry, { nodes: { s: { definition: "spawner", config: null } } }, { id: "parent" });
	const changes: HostChange[] = [];
	host.watch((change) => changes.push(change));

	await host.submit("parent", "s", { type: "spawn", body: { id: "child", template: "elsewhere" } });
	await host.idle();

	const expected: Unready = {
		scope: "trigger",
		workflowId: "child",
		trigger: "in",
		reason: 'no listener "elsewhere" in this deployment',
	};
	assert.deepEqual(host.unready(), [expected]);
	assert.deepEqual(unready, [expected]);
	assert.ok(changes.some((change) => change.scope === "unready"));
	assert.ok(changes.some((change) => change.scope === "workflow" && change.id === "child"));
});

test("a watcher hears the workflow change while an effect is out and again when it is back", async () => {
	const slow = gate();
	const { store, host } = setup({ performers: slow.performers });
	await createWorkflow(store, registry, one, { id: "a" });
	const heard: string[] = [];
	const stop = host.watch((change) => {
		if (change.scope === "workflow") heard.push(`${change.id}:${host.executing(change.id).length}`);
	});

	await host.submit("a", "w", { type: "go", body: 1 });
	assert.ok(heard.includes("a:1"), `heard ${heard.join(",")}`);

	slow.release();
	await host.idle();
	assert.equal(heard.at(-1), "a:0");

	stop();
	const before = heard.length;
	await host.submit("a", "w", { type: "note", body: 2 });
	assert.equal(heard.length, before);
});

test("a watcher that throws does not break the push", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, one, { id: "a" });
	host.watch(() => {
		throw new Error("watcher exploded");
	});
	await host.submit("a", "w", { type: "note", body: 1 });
	assert.equal((await got(host, "a")).length, 1);
});

// ── 模板目录（ADR-0018） ───────────────────────────────────────────────────────

test("spawn takes the template by name and fills its params", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, { nodes: { s: { definition: "spawner", config: null } } }, { id: "parent" });
	await host.submit("parent", "s", { type: "spawn", body: { id: "c7", template: "chat", params: { chatId: 7 } } });
	await host.idle();
	assert.deepEqual((await store.load("c7"))?.graph.shape.triggers[0]?.match, { fn: "chatIs", config: { chatId: 7 } });
});

test("a spawn naming a missing template, or with bad params, fails its receipt and halts nothing", async () => {
	const { store, host } = setup();
	await createWorkflow(store, registry, { nodes: { s: { definition: "spawner", config: null } } }, { id: "parent" });
	await host.submit("parent", "s", { type: "spawn", body: { id: "x", template: "nope" } });
	await host.submit("parent", "s", { type: "spawn", body: { id: "y", template: "chat", params: { other: 1 } } });
	await host.idle();

	assert.deepEqual(await store.ids(), ["parent"]);
	const parent = await store.load("parent");
	assert.equal(parent?.halted, undefined);
	assert.equal(parent?.inFlight.length, 0, "both receipts came back");
});

test("create fills params, and exposes the template directory it was given", async () => {
	const { store, host } = setup();
	assert.deepEqual(Object.keys(host.templates), ["chat"]);
	await host.create(chatTemplate, { id: "c", params: { chatId: 3 } });
	assert.deepEqual((await store.load("c"))?.graph.shape.triggers[0]?.match, { fn: "chatIs", config: { chatId: 3 } });
	await assert.rejects(host.create(chatTemplate, { id: "d", params: { nope: 1 } }), InstantiateError);
});
