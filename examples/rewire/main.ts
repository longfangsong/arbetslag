/**
 * 改图的车间：图从只有一个 `hub` 开始，加工节点由 webhook 发来的命令在运行时增删。
 *
 * - `{"add": "upper"}`    → `hub` 交出一个 `graph.mutate`：spawn 一个 `stage` 节点，再把 `hub.text` 接到它
 * - `{"remove": "upper"}` → `graph.mutate` 回收它（连带删边）
 * - `{"text": "hello"}`   → `hub` 沿 `text` 端口发出：形状里接了几个 stage 就投几份（ADR-0011）
 *
 * 改图非法（重名、未知的加工方式、回收不存在的节点）不停住：回执是失败，`hub` 把违规记进自己的 state。
 * 每个 stage 说话走 `stage.say`，Performer 故意慢（`SAY_DELAY_MS`，默认 1.5 秒），好在监控里看见**等回执**。
 */
import type { JsonValue } from "type-fest";
import { z } from "zod";
import { type WorkflowTemplate, createRegistry, defineNode } from "@arbetslag/kernel";
import { createHost, createSqliteStore, createWebhookRuntime, webhookKind } from "@arbetslag/host-node";
import { createMonitor } from "@arbetslag/monitor";
import workshop from "./workshop.template.json" with { type: "json" };

const WEBHOOK_PORT = Number(process.env.PORT ?? 8788);
const MONITOR_PORT = Number(process.env.MONITOR_PORT ?? 8791);
const DELAY_MS = Number(process.env.SAY_DELAY_MS ?? 1500);
const WORKFLOW = "workshop";
/** state 里的日志只留最近这么多条。 */
const KEEP = 10;

const anyJson: z.ZodType<JsonValue> = z.json();

// ── 加工节点 ────────────────────────────────────────────────────────────────

const transforms = {
	upper: (text: string) => text.toUpperCase(),
	lower: (text: string) => text.toLowerCase(),
	reverse: (text: string) => [...text].reverse().join(""),
	shout: (text: string) => `${text.toUpperCase()}!!!`,
	spaced: (text: string) => [...text].join(" "),
} as const;
type Transform = keyof typeof transforms;
const transformSchema = z.enum(Object.keys(transforms) as [Transform, ...Transform[]]);

/** 收到 `text` 就按 config 加工一遍，交出 `stage.say`；回执回来记一笔。 */
const stage = defineNode({
	name: "stage",
	version: 1,
	state: z.object({ said: z.number() }).default({ said: 0 }),
	config: z.object({ transform: transformSchema }),
	ports: () => ({}),
	step: ({ self, config, state, message }) => {
		if (message.type === "text") {
			const { text } = message.body as { text: string };
			return {
				state,
				effects: [{ kind: "stage.say", input: { from: self, text: transforms[config.transform](text) } }],
			};
		}
		if (message.type === "@effect.end") return { state: { said: state.said + 1 } };
		return { state };
	},
});

// ── hub：收命令、改图、广播 ─────────────────────────────────────────────────

const command = z.union([
	z.object({ add: z.string().min(1) }),
	z.object({ remove: z.string().min(1) }),
	z.object({ text: z.string() }),
]);

type LogEntry = { command: string; ok: boolean; violations?: JsonValue[] };

const hub = defineNode({
	name: "hub",
	version: 1,
	state: z
		.object({ stages: z.array(z.string()), log: z.array(anyJson), rejected: z.number() })
		.default({ stages: [], log: [], rejected: 0 }),
	config: z.null(),
	ports: () => ({ text: z.object({ text: z.string() }) }),
	step: ({ self, state, message }) => {
		if (message.type === "command") {
			const parsed = command.safeParse(message.body);
			if (!parsed.success) return { state: { ...state, rejected: state.rejected + 1 } };
			const cmd = parsed.data;
			if ("text" in cmd) return { state, sends: [{ port: "text", body: { text: cmd.text } }] };
			if ("add" in cmd) {
				// 节点 id 就是加工方式的名字：同一种加两次会因重名被拒（`spawn_id_taken`）。
				const ops: JsonValue[] = [
					{ op: "spawn", id: cmd.add, definition: "stage", config: { transform: cmd.add } },
					{ op: "connect", from: self, to: cmd.add, port: "text" },
				];
				return { state, effects: [{ kind: "graph.mutate", input: { ops }, correlationId: `add:${cmd.add}` }] };
			}
			const ops: JsonValue[] = [{ op: "retire", id: cmd.remove }];
			return { state, effects: [{ kind: "graph.mutate", input: { ops }, correlationId: `remove:${cmd.remove}` }] };
		}

		if (message.type === "@effect.end") {
			const { correlationId, result } = message.body as {
				correlationId?: string;
				result: { ok: boolean; violations?: JsonValue[] };
			};
			const [verb, id] = (correlationId ?? "").split(":");
			if ((verb !== "add" && verb !== "remove") || id === undefined) return { state };
			const entry: LogEntry = { command: correlationId ?? "", ok: result.ok };
			if (!result.ok) entry.violations = result.violations ?? [];
			const stages = !result.ok
				? state.stages
				: verb === "add"
					? [...state.stages, id]
					: state.stages.filter((s) => s !== id);
			return { state: { ...state, stages, log: [...state.log, entry as JsonValue].slice(-KEEP) } };
		}
		return { state };
	},
});

// ── 部署 ────────────────────────────────────────────────────────────────────

const registry = createRegistry({
	nodes: [hub, stage],
	effects: [
		{ kind: "stage.say", input: z.object({ from: z.string(), text: z.string() }), result: z.null() },
	],
	triggers: [webhookKind],
});

const store = createSqliteStore({ file: new URL("./data/rewire.sqlite", import.meta.url).pathname });

const host = createHost({
	store,
	registry,
	performers: {
		"stage.say": async (input) => {
			await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
			const { from, text } = input as { from: string; text: string };
			console.log(`  [${from}] ${text}`);
			return null;
		},
	},
	listeners: [
		{ id: "workshop", kind: "webhook", config: { port: WEBHOOK_PORT, path: "/workshop", output: "command" } },
	],
	runtimes: { webhook: createWebhookRuntime() },
	retryMs: 1000,
	onUnready: (info) => console.log(`! 未就绪 ${info.scope === "listener" ? info.listener : info.trigger}：${info.reason}`),
});

await host.start();
if ((await host.snapshot(WORKFLOW)) === undefined) {
	await host.create(workshop as WorkflowTemplate, { id: WORKFLOW });
	console.log(`创建了工作流 ${WORKFLOW}：只有一个 hub`);
}
const monitor = await createMonitor({ host, port: MONITOR_PORT });

const url = `http://127.0.0.1:${WEBHOOK_PORT}/workshop`;
console.log(`监控    ${monitor.url}/#/workflows/${WORKFLOW}`);
console.log(`命令    POST ${url}`);
console.log(`  curl -H 'content-type: application/json' -d '{"add":"upper"}' ${url}`);
console.log(`  curl -H 'content-type: application/json' -d '{"text":"hello"}' ${url}`);
console.log(`  curl -H 'content-type: application/json' -d '{"remove":"upper"}' ${url}`);
console.log(`  加工方式：${Object.keys(transforms).join("、")}`);

process.once("SIGINT", () => {
	void (async () => {
		await host.stop();
		await monitor.close();
		store.close();
		process.exit(0);
	})();
});
