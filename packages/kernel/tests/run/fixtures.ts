import { z } from "zod";
import { createMemoryLog } from "../../src/transitionLog.ts";
import { createMemoryStore } from "../../src/memoryStore.ts";
import { defineNode } from "../../src/nodeDefinition.ts";
import { createRegistry } from "../../src/registry.ts";
import { createWorkflow, type WorkflowTemplate } from "../../src/workflow/template/index.ts";

const anyJson = z.json();

/**
 * 收到任何消息都计数并沿 `out` 原样转发。端口名就是消息的类别（ADR-0005），
 * 所以上游沿 `out` 发来的消息到这里类别也是 `out`，不能只认 `in`。
 */
export const relay = defineNode({
	name: "relay",
	version: 1,
	state: z.object({ count: z.number() }).default({ count: 0 }),
	config: z.null(),
	ports: () => ({ out: anyJson }),
	step: ({ state, message }) => ({
		state: { count: state.count + 1 },
		sends: [{ port: "out", body: message.body }],
	}),
});

/** 收到 `go` 交出一个 timer.wait 效果；收到回执后沿 `out` 发出回执的 body。 */
export const emitter = defineNode({
	name: "emitter",
	version: 1,
	state: z.object({ seen: z.array(z.string()) }).default({ seen: [] }),
	config: z.null(),
	ports: () => ({ out: anyJson }),
	step: ({ state, message }) => {
		switch (message.type) {
			case "go":
				return { state, effects: [{ kind: "timer.wait", input: { ms: 1 }, correlationId: "c1" }] };
			case "@effect.end":
				return { state: { seen: [...state.seen, "receipt"] }, sends: [{ port: "out", body: message.body }] };
			default:
				return { state };
		}
	},
});

/** 一个故意写坏的节点，按收到的消息类别犯不同的错。 */
export const faulty = defineNode({
	name: "faulty",
	version: 1,
	state: z.object({ ok: z.boolean() }).default({ ok: true }),
	config: z.null(),
	ports: () => ({ out: z.number() }),
	step: ({ state, message }) => {
		switch (message.type) {
			case "throw":
				throw new Error("boom");
			case "not-a-transition":
				return undefined as never;
			case "bad-state":
				return { state: { ok: "nope" } as never };
			case "reserved":
				return { state, sends: [{ port: "@effect.end", body: 1 }] };
			case "undeclared":
				return { state, sends: [{ port: "nowhere", body: 1 }] };
			case "bad-body":
				return { state, sends: [{ port: "out", body: "not a number" }] };
			case "unknown-effect":
				return { state, effects: [{ kind: "nope", input: null }] };
			case "bad-effect-input":
				return { state, effects: [{ kind: "timer.wait", input: { ms: "x" } }] };
			case "send-then-fail":
				return { state: { ok: "nope" } as never, sends: [{ port: "out", body: 1 }] };
			case "direct":
				return { state, sends: [{ port: "out", body: 1, to: String(message.body) }] };
			default:
				return { state };
		}
	},
});

export const registry = createRegistry({
	nodes: [relay, emitter, faulty],
	effects: [{ kind: "timer.wait", input: z.object({ ms: z.number() }), result: z.null() }],
	triggers: [
		{
			kind: "hook",
			config: z.object({}),
			outputs: () => ({ text: z.string() }),
		},
	],
});

export const chain: WorkflowTemplate = {
	nodes: {
		a: { definition: "relay", config: null },
		b: { definition: "relay", config: null },
		c: { definition: "relay", config: null },
	},
	edges: [
		{ from: "a", to: "b", port: "out" },
		{ from: "b", to: "c", port: "out" },
	],
};

export async function setup(template: WorkflowTemplate = chain, id = "w") {
	const store = createMemoryStore();
	const log = createMemoryLog();
	await createWorkflow(store, registry, template, { id });
	return { store, log, id };
}

/** 确定的 effectId 与时钟，让断言可以写死。 */
export function deterministic() {
	let n = 0;
	return {
		newEffectId: () => `e${++n}`,
		now: () => new Date("2026-10-25T00:00:00.000Z"),
	};
}

export const load = async (store: ReturnType<typeof createMemoryStore>, id = "w") => {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new Error("missing workflow");
	return loaded.snapshot;
};
