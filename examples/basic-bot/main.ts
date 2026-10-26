/**
 * 最小可跑的 demo：模板 → 实例化 → 投递 → 推进 → 效果 → 回执 → 打印，
 * 外加宿主那一侧的两件事：**触发器对账**（webhook）与**恢复扫描**。
 *
 * 这里没有真的模型：`llm.complete` 由本文件里的假 **Performer** 实现（5ms 的"网络延迟"）。
 * 换成真模型只需要换一个 Performer（`packages/llm`），图、内核、宿主都不用动。
 */
import { z } from "zod";
import {
	type LogEntry,
	type TransitionLog,
	type WorkflowTemplate,
	createMemoryStore,
	createRegistry,
	createWorkflow,
	defineNode,
	deliverToNode,
} from "@arbetslag/kernel";
import {
	type Performers,
	createHost,
	createMemoryIndex,
	createWebhookRuntime,
	recover,
	submit,
	webhookKind,
} from "@arbetslag/host-node";

/** 监听端口；被占就演示「未就绪」（ADR-0001）。 */
const PORT = Number(process.env.PORT ?? 8787);

// ── 节点定义 ────────────────────────────────────────────────────────────────

/** 最小的"agent"节点：收到 `chat` 就问模型，收到回执把回答转给 printer。 */
const bot = defineNode({
	name: "bot",
	version: 1,
	state: z.object({ asked: z.number() }).default({ asked: 0 }),
	config: z.object({ model: z.string() }),
	ports: () => ({ reply: z.object({ text: z.string() }) }),
	step: ({ state, config, message }) => {
		switch (message.type) {
			case "chat": {
				const { text } = message.body as { text: string };
				const asked = state.asked + 1;
				return {
					state: { asked },
					effects: [
						{
							kind: "llm.complete",
							input: { model: config.model, prompt: text },
							correlationId: `ask-${asked}`,
						},
					],
				};
			}
			case "@effect.end": {
				// 回执按 `correlationId` 配对：改图的回执没有后续，别当成模型的话。
				const { correlationId, result } = message.body as {
					correlationId: string;
					result: { ok: true; text: string } | { ok: false; error: string };
				};
				if (correlationId === "unhook") return { state };
				const text = result.ok ? result.text : `（模型挂了：${result.error}）`;
				return { state, sends: [{ port: "reply", body: { text } }] };
			}
			case "unhook":
				// 改图也是效果：拆掉 webhook 触发器，宿主推完之后会对账、把监听关掉（ADR-0001）。
				return {
					state,
					effects: [
						{
							kind: "graph.mutate",
							input: { ops: [{ op: "removeTrigger", id: "hook" }] },
							correlationId: "unhook",
						},
					],
				};
			default:
				return { state };
		}
	},
});

/** 收到 `reply` 就往世界外写一行（也是效果，因为写 stdout 是副作用）。 */
const printer = defineNode({
	name: "printer",
	version: 1,
	state: z.object({ printed: z.number() }).default({ printed: 0 }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type !== "reply") return { state }; // 回执：没有后续
		const printed = state.printed + 1;
		return {
			state: { printed },
			effects: [
				{
					kind: "log.line",
					input: { text: (message.body as { text: string }).text },
					correlationId: `print-${printed}`,
				},
			],
		};
	},
});

// ── 模板、注册表、Performer ─────────────────────────────────────────────────

const template: WorkflowTemplate = {
	nodes: {
		bot: { definition: "bot", config: { model: "fake-echo-1" } },
		printer: { definition: "printer", config: null },
	},
	edges: [
		{ from: "bot", to: "printer", port: "reply" },
		// 触发器的输出就是端口：webhook 进来的 body 变成一条 `chat` 消息（ADR-0001）。
		{ from: "hook", to: "bot", port: "chat" },
	],
	triggers: [{ id: "hook", kind: "webhook", config: { port: PORT, path: "/hook", output: "chat" } }],
};

const registry = createRegistry({
	nodes: [bot, printer],
	effects: [
		{
			kind: "llm.complete",
			input: z.object({ model: z.string(), prompt: z.string() }),
			result: z.union([
				z.object({ ok: z.literal(true), text: z.string() }),
				z.object({ ok: z.literal(false), error: z.string() }),
			]),
		},
		{ kind: "log.line", input: z.object({ text: z.string() }), result: z.null() },
	],
	triggers: [webhookKind],
});

const performers: Performers = {
	"llm.complete": async (input) => {
		const { prompt } = input as { prompt: string };
		await new Promise((resolve) => setTimeout(resolve, 5)); // 假装有网络
		return { ok: true, text: `（echo）你说的是「${prompt}」` };
	},
	"log.line": (input) => {
		console.log(`      🖨  ${(input as { text: string }).text}`);
		return null;
	},
};

// ── 转移日志：旁路，只打印 ──────────────────────────────────────────────────

const describe = (entry: LogEntry): string => {
	switch (entry.type) {
		case "transition":
			return `转移 ${entry.node} ← ${entry.messageType}（发出 ${entry.sends}，效果 ${entry.effects}）`;
		case "dropped":
			return `丢弃 ${entry.from}.${entry.port}（${entry.reason}）`;
		case "migrated":
			return `迁移 ${entry.node} v${entry.from} → v${entry.to}`;
		case "halted":
			return `停住 ${entry.code}：${entry.detail}`;
	}
};

const log: TransitionLog = {
	append: (_id, entries) => {
		for (const entry of entries) console.log(`      · ${describe(entry)}`);
	},
};

// ── 跑起来 ──────────────────────────────────────────────────────────────────

const store = createMemoryStore();
const ids: string[] = [];
/** 内存索引：Node 上是扫目录，这里是数组（ADR-0003）。 */
const index = createMemoryIndex(ids);

const host = createHost({
	store,
	registry,
	performers,
	log,
	triggers: {
		runtimes: { webhook: createWebhookRuntime() },
		retryMs: 200,
		onUnready: (info) => console.log(`      ! 未就绪 ${info.trigger}：${info.reason}（会在 ${200}ms 后重试）`),
	},
});

const { id, revision } = await createWorkflow(store, registry, template, { id: "demo" });
ids.push(id);
const snapshot = async (workflowId = id) => {
	const loaded = await store.load(workflowId);
	if (loaded === undefined) throw new Error("工作流不见了");
	return loaded.snapshot;
};

console.log(`工作流 ${id} 实例化完成（revision ${revision}）`);
console.log(`形状：${Object.keys((await snapshot()).graph.shape.nodes).join("、")}\n`);

// ── 1. 直接投递：串行入口 ───────────────────────────────────────────────────

console.log("① 三条消息同时投递给同一份工作流，串行入口让它们逐个跑完（ADR-0003）\n");
const questions = ["你好", "今天几号", "再见"];
const results = await Promise.all(
	questions.map(async (text) => {
		console.log(`→ 投递 chat：${text}`);
		const result = await submit(host, id, "bot", { type: "chat", body: { text } });
		console.log(`← 静止（${result.rounds} 轮、结算 ${result.settled} 个效果：问模型 + 打印）\n`);
		return result;
	}),
);

// ── 2. 触发器：webhook 起监听、对账、未就绪 ─────────────────────────────────

console.log("② 宿主对账：快照里声明了 webhook，就该有一个活着的监听（ADR-0001）");
const sync = await host.triggers?.reconcile(id);
if (sync !== undefined && sync.unready.length > 0) {
	console.log("   监听没起来，走未就绪：不停住、不进快照，工作流照常可用。");
} else {
	const url = `http://127.0.0.1:${PORT}/hook`;
	console.log(`   监听已起：POST ${url}  {"text":"..."}`);
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text: "从 webhook 进来的消息" }),
	});
	console.log(`   webhook 回 ${response.status}\n`);
}

// ── 3. 改图拆触发器：对账把监听关掉 ─────────────────────────────────────────

console.log("③ 节点出一个 graph.mutate 拆掉触发器，宿主在同一轮里关掉监听");
await submit(host, id, "bot", { type: "unhook", body: null });
console.log(`   现在开着的触发器：${JSON.stringify(host.triggers?.running(id))}\n`);

// ── 4. 恢复扫描：投递成功、Run 没跑的悬挂态 ─────────────────────────────────

console.log("④ 恢复扫描：只落了邮件、还没 Run 的工作流（模拟进程在中间被杀）");
const hanging = await createWorkflow(store, registry, template, { id: "recover-me" });
ids.push(hanging.id);
await deliverToNode(store, hanging.id, "bot", { type: "chat", body: { text: "崩溃前的最后一句" } });

const report = await recover(host, index);
console.log(
	`   扫了 ${report.scanned} 份：推进 ${report.advanced.length}、静止 ${report.quiescent.length}、停住 ${report.halted.length}、失败 ${report.failed.length}`,
);
console.log(`   捡起来的是：${report.advanced.map((entry) => entry.id).join("、")}\n`);

// ── 收尾 ────────────────────────────────────────────────────────────────────

await host.triggers?.stop();

const final = await snapshot();
console.log("最终快照");
console.log(`  bot      ${JSON.stringify(final.graph.nodeStates.bot?.state)}`);
console.log(`  printer  ${JSON.stringify(final.graph.nodeStates.printer?.state)}`);
console.log(
	`  在飞效果 ${final.inFlight.length} 个；每条消息都推到了静止：${results.every((r) => r.status === "quiescent")}`,
);
console.log(`  每条消息各自结算了两个效果（问模型 + 打印）：${results.every((r) => r.settled === 2)}`);
