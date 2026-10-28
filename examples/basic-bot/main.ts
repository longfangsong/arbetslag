/**
 * 最小可跑的 demo：模板 → 实例化 → 投递 → 推进 → 效果 → 回执 → 打印，
 * 外加宿主那一侧的两件事：**触发器对账**（webhook）与**恢复扫描**。
 *
 * 这里的 agent 是 `@arbetslag/agents` 的节点定义（ADR-0009）：一个普通节点，
 * 循环在图里——问模型、调一个工具、拿到结果再问，最后沿 `reply` 回话。
 * 模型仍然是假的（本文件里的假 **Performer**，5ms 的"网络延迟"），换成真模型
 * 只需要把 `modelPerformer(fakeModel)` 换成 `@arbetslag/llm/openai` 的实现，图不用动。
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
	type ModelCompleteResult,
	APPEND_PORT,
	CONVERSATION_NAME,
	HISTORY_PORT,
	agent,
	agentLayout,
	conversation,
	defineTool,
	modelCompleteKind,
	textOf,
} from "@arbetslag/agents";
import {
	type Performers,
	createHost,
	createMemoryIndex,
	createWebhookRuntime,
	recover,
	submit,
	webhookKind,
} from "@arbetslag/host-node";
import { type ModelCall, modelPerformer } from "@arbetslag/llm";

/** 监听端口；被占就演示「未就绪」（ADR-0001）。 */
const PORT = Number(process.env.PORT ?? 8787);

// ── 节点定义 ────────────────────────────────────────────────────────────────

/** 一个工具：普通节点定义 + 元数据（ADR-0009）。同步、纯，所以不来效果。 */
const clock = defineTool({
	name: "clock",
	description: "看看现在几点",
	input: z.object({}),
	state: z.null().default(null),
	config: z.null(),
	run: () => ({ state: null, result: { time: new Date().toISOString().slice(11, 19) } }),
});

/** 收到 `reply` 就往世界外写一行（写 stdout 是副作用，所以走效果）。 */
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

/** 运维用的小节点：收到 `unhook` 就拆触发器（改图也是效果）。 */
const admin = defineNode({
	name: "admin",
	version: 1,
	state: z.null().default(null),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type !== "unhook") return { state };
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
	},
});

// ── 模板、注册表、Performer ─────────────────────────────────────────────────

/** 工具只写一遍：schema 抄进 agent config，边也一并生成（ADR-0009）。 */
const layout = agentLayout({
	agent: "bot",
	config: { model: "fake-model-1", system: "你是个简洁的助手" },
	tools: [{ tool: clock }],
});

const template: WorkflowTemplate = {
	nodes: {
		...layout.nodes,
		// 对话历史在 `chat` 这个节点里（ADR-0010）：agent 自己不再存 history。
		chat: { definition: CONVERSATION_NAME, config: null },
		printer: { definition: "printer", config: null },
		admin: { definition: "admin", config: null },
	},
	edges: [
		...layout.edges,
		{ from: "chat", to: "bot", port: HISTORY_PORT },
		{ from: "bot", to: "chat", port: APPEND_PORT },
		{ from: "bot", to: "printer", port: "reply" },
		// 触发器的输出就是端口：webhook 进来的 body 变成一条 `user` 消息（ADR-0001）。
		{ from: "hook", to: "chat", port: "user" },
	],
	triggers: [{ id: "hook", kind: "webhook", config: { port: PORT, path: "/hook", output: "user" } }],
};

const registry = createRegistry({
	nodes: [agent, conversation, clock, printer, admin],
	effects: [
		modelCompleteKind,
		// `graph.mutate` 是内核自带的效果种类，不用注册。
		{ kind: "log.line", input: z.object({ text: z.string() }), result: z.null() },
	],
	triggers: [webhookKind],
});

/**
 * 假模型：第一次要 `clock`，看到工具结果就把时间说出来。
 * 这段"剧本"就是宿主里 Performer 该做的事——真模型换掉它，图一个字节都不用改。
 */
const fakeModel: ModelCall = async ({ input }) => {
	await new Promise((resolve) => setTimeout(resolve, 5)); // 假装有网络
	// 只看这一轮（最后一句 user 之后）发生过什么：历史里的旧工具结果不算数。
	const askedAt = input.messages.reduce((at, message, index) => (message.role === "user" ? index : at), 0);
	const asked = input.messages[askedAt];
	const results = input.messages
		.slice(askedAt)
		.flatMap((message) => message.blocks)
		.filter((block) => block.type === "tool-result");

	if (results.length === 0) {
		return {
			ok: true,
			message: {
				role: "assistant",
				blocks: [{ type: "tool-call", callId: "c1", name: "clock", input: {} }],
			},
		} satisfies ModelCompleteResult;
	}

	const last = results.at(-1) as { result: { time?: string } };
	return {
		ok: true,
		message: {
			role: "assistant",
			blocks: [{ type: "text", text: `现在是 ${last.result.time}（你问的是「${asked === undefined ? "" : textOf(asked)}」）` }],
		},
	};
};

const performers: Performers = {
	"model.complete": modelPerformer(fakeModel),
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
		onUnready: (info) => console.log(`      ! 未就绪 ${info.trigger}：${info.reason}（会在 200ms 后重试）`),
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
		console.log(`→ 投递 user：${text}`);
		const result = await submit(host, id, "chat", { type: "user", body: { text } });
		console.log(
			`← 静止（${result.rounds} 轮、结算 ${result.settled} 个效果：问模型 ×2 + 打印）\n`,
		);
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
await submit(host, id, "admin", { type: "unhook", body: null });
console.log(`   现在开着的触发器：${JSON.stringify(host.triggers?.running(id))}\n`);

// ── 4. 恢复扫描：投递成功、Run 没跑的悬挂态 ─────────────────────────────────

console.log("④ 恢复扫描：只落了邮件、还没 Run 的工作流（模拟进程在中间被杀）");
const hanging = await createWorkflow(store, registry, template, { id: "recover-me" });
ids.push(hanging.id);
await deliverToNode(store, hanging.id, "chat", { type: "user", body: { text: "崩溃前的最后一句" } });

const report = await recover(host, index);
console.log(
	`   扫了 ${report.scanned} 份：推进 ${report.advanced.length}、静止 ${report.quiescent.length}、停住 ${report.halted.length}、失败 ${report.failed.length}`,
);
console.log(`   捡起来的是：${report.advanced.map((entry) => entry.id).join("、")}\n`);

// ── 收尾 ────────────────────────────────────────────────────────────────────

await host.triggers?.stop();

const final = await snapshot();
const chatState = final.graph.nodeStates.chat?.state as { history: { role: string }[] };
console.log("最终快照");
console.log(`  chat     history ${chatState.history.length} 条：${chatState.history.map((m) => m.role).join("、")}`);
console.log(`  printer  ${JSON.stringify(final.graph.nodeStates.printer?.state)}`);
console.log(
	`  在飞效果 ${final.inFlight.length} 个；每条消息都推到了静止：${results.every((r) => r.status === "quiescent")}`,
);
// 一次提问结算三个效果：问模型（要工具）→ 问模型（有结果了）→ 打印。
console.log(`  每条消息各自结算了三个效果：${results.every((r) => r.settled === 3)}`);
