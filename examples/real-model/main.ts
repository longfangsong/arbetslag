/**
 * 真模型的端到端 demo：`@arbetslag/llm` 的 LLM 节点 + 一个工具 + `@arbetslag/llm/openai` 的 Performer。
 *
 * 图、内核、宿主和 `basic-bot` 一模一样，差别只有一处：`model.complete` 的 **Performer**
 * 从"假剧本"换成了真的模型调用（ADR-0009：厂商翻译在 Performer 里，图不认识厂商）。
 *
 *   ARBETSLAG_MODEL=zd/deepseek-flash \
 *   ARBETSLAG_BASE_URL=https://…/v1 \
 *   ARBETSLAG_API_KEY=sk-… \
 *   pnpm --filter @arbetslag/example-real-model start
 */
import { z } from "zod";
import {
	type LogEntry,
	type TransitionLog,
	type WorkflowTemplate,
	createRegistry,
	createWorkflow,
	defineNode,
} from "@arbetslag/kernel";
import {
	APPEND_PORT,
	CONVERSATION_NAME,
	HISTORY_PORT,
	llm,
	wireTools,
	conversation,
	defineTool,
	modelCompleteKind,
} from "@arbetslag/llm";
import { createHost, createSqliteStore } from "@arbetslag/host-node";
import { modelPerformer } from "@arbetslag/llm";
import { createOpenAIModel } from "@arbetslag/llm/openai";

const model = process.env.ARBETSLAG_MODEL;
const baseURL = process.env.ARBETSLAG_BASE_URL;
const apiKey = process.env.ARBETSLAG_API_KEY;
if (model === undefined || baseURL === undefined || apiKey === undefined) {
	throw new Error("需要 ARBETSLAG_MODEL、ARBETSLAG_BASE_URL、ARBETSLAG_API_KEY 三个环境变量");
}

/** 一个真会出结果的工具：模型要时间就调它。 */
const clock = defineTool({
	name: "clock",
	description: "看当前时间（UTC，形如 08:15:00）",
	input: z.object({}),
	state: z.null().default(null),
	config: z.null(),
	run: () => ({ state: null, result: { time: new Date().toISOString().slice(11, 19) } }),
});

/** 出口：把 LLM 节点的回复写到 stdout（写世界外是副作用，所以走效果）。 */
const printer = defineNode({
	name: "printer",
	version: 1,
	state: z.object({ printed: z.number() }).default({ printed: 0 }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type !== "reply") return { state };
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

const layout = wireTools({
	llm: "bot",
	config: { model, system: "你是个简洁的助手。需要时间就用 clock 工具查，不要猜。" },
	tools: [{ node: clock }],
});

const template: WorkflowTemplate = {
	nodes: {
		...layout.nodes,
		// 对话历史在 `chat` 里（ADR-0010）：LLM 节点只管问模型。
		chat: { definition: CONVERSATION_NAME, config: null },
		printer: { definition: "printer", config: null },
	},
	edges: [
		...layout.edges,
		{ from: "chat", to: "bot", port: HISTORY_PORT },
		{ from: "bot", to: "chat", port: APPEND_PORT },
		{ from: "bot", to: "printer", port: "reply" },
	],
};

const registry = createRegistry({
	nodes: [llm, conversation, clock, printer],
	effects: [
		modelCompleteKind,
		{ kind: "log.line", input: z.object({ text: z.string() }), result: z.null() },
	],
});

const log: TransitionLog = {
	append: (_id, entries) => {
		for (const entry of entries) {
			const text: string =
				entry.type === "transition"
					? `转移 ${entry.node} ← ${entry.messageType}（发出 ${entry.sends}，效果 ${entry.effects}）`
					: entry.type === "halted"
						? `停住 ${entry.code}：${entry.detail}`
						: `${entry.type} ${JSON.stringify(entry)}`;
			console.log(`   · ${text}`);
		}
	},
};

const store = createSqliteStore({ file: ":memory:" });
const host = createHost({
	store,
	registry,
	performers: {
		"model.complete": modelPerformer(createOpenAIModel({ apiKey, baseURL })),
		"log.line": (input) => {
			console.log(`\n🤖 ${(input as { text: string }).text}\n`);
			return null;
		},
	},
	log,
});

const { id } = await createWorkflow(store, registry, template, { id: "real" });
console.log(`模型 ${model} @ ${baseURL}\n`);

const question = process.argv[2] ?? "现在几点了？查一下再告诉我。";
console.log(`→ ${question}`);
await host.submit(id, "chat", { type: "user", body: { text: question } });
// 效果（模型调用、工具、打印）由激活在后台执行，回执回来再接着推（ADR-0014）。
await host.idle();
console.log("← 静止");

const loaded = await store.load(id);
// 历史在 conversation（节点 id `chat`）身上，不在 LLM 节点上（ADR-0010）。
const state = loaded?.graph.nodeStates.chat?.state as
	| { history: { role: string; blocks: { type: string }[] }[] }
	| undefined;
console.log(`\nhistory：${state?.history.map((message) => message.role).join("、")}`);
const toolCalls = state?.history.flatMap((message) => message.blocks).filter((block) => block.type === "tool-call");
console.log(`工具调用 ${toolCalls?.length ?? 0} 次`);

export type { LogEntry };
