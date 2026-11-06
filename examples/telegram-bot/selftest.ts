/**
 * 自测：不碰 Telegram，只验「聊天消息 → 路由 → 总机起会话工作流 → LLM 节点用真模型（真的调工具）→ 回复出图」这一条链。
 *
 * 用假的监听器 transport 造一条消息，用假的发送把回复接住；模型是真的。
 * 模型配错了、工具 schema 和模型对不上、图接错了，这里都会露出来。
 *
 *   ARBETSLAG_MODEL=… ARBETSLAG_BASE_URL=… ARBETSLAG_API_KEY=… \
 *   pnpm --filter @arbetslag/example-telegram-bot selftest
 */
import type { JsonValue } from "type-fest";
import { type TransitionLog, createWorkflow } from "@arbetslag/kernel";
import { type TelegramTransport, createHost, createSqliteStore, createTelegramRuntime } from "@arbetslag/host-node";
import { modelPerformer } from "@arbetslag/llm";
import { createOpenAIModel } from "@arbetslag/llm/openai";
import { LISTENER, SWITCHBOARD, buildGraph, chatWorkflowId } from "./graph.ts";

const env = (name: string): string => {
	const value = process.env[name];
	if (value === undefined || value === "") throw new Error(`需要环境变量 ${name}`);
	return value;
};

const question = process.argv[2] ?? "现在几点了？查一下再告诉我。";

/** 一条假消息进来，之后再无更新（挂在长轮询上直到被关掉）。 */
let polls = 0;
const transport: TelegramTransport = async (method, _body, signal) => {
	if (method === "getMe") return { username: "selftest" };
	if (method === "getUpdates") {
		if (polls++ > 0) {
			return new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			});
		}
		return [
			{
				update_id: 1,
				message: { message_id: 1, chat: { id: 1 }, from: { username: "selftest" }, text: question },
			},
		];
	}
	return null;
};

const log: TransitionLog = {
	append: (id, entries) => {
		for (const entry of entries) {
			if (entry.type === "transition") console.log(`   · ${id} ${entry.node} ← ${entry.messageType}`);
			else if (entry.type === "halted") console.log(`   ✖ ${id} 停住 ${entry.code}：${entry.detail}`);
		}
	},
};

const sent: string[] = [];
let done: () => void = () => {};
const answered = new Promise<void>((resolve) => {
	done = resolve;
});

const { switchboardTemplate, templates, registry } = buildGraph({
	model: env("ARBETSLAG_MODEL"),
	system: "你是个简洁的助手，回答用中文，不超过三句。需要当前时间就用 clock 工具查，不要猜。",
});

const store = createSqliteStore({ file: ":memory:" });
const host = createHost({
	store,
	registry,
	templates,
	performers: {
		"model.complete": modelPerformer(
			createOpenAIModel({ apiKey: env("ARBETSLAG_API_KEY"), baseURL: env("ARBETSLAG_BASE_URL") }),
		),
		"telegram.send": (input): JsonValue => {
			const { chatId, text } = input as { chatId: number; text: string };
			console.log(`🤖 → ${chatId}: ${text}`);
			sent.push(text);
			done();
			return { ok: true };
		},
	},
	log,
	listeners: [{ id: LISTENER, kind: "telegram", config: {} }],
	runtimes: { telegram: createTelegramRuntime({ bots: {}, transport }) },
	onUnready: (info) => console.log(`   ! 未就绪 ${info.scope === "listener" ? info.listener : info.trigger}：${info.reason}`),
});

await createWorkflow(store, registry, switchboardTemplate, { id: SWITCHBOARD });
console.log(`模型 ${env("ARBETSLAG_MODEL")}；问题「${question}」`);
await host.start();

const timeout = new Promise<void>((_resolve, reject) =>
	setTimeout(() => reject(new Error("60s 内没有回复")), 60_000).unref(),
);
await Promise.race([answered, timeout]);
await host.stop();
await host.idle();

const loaded = await store.load(chatWorkflowId(1));
// 历史在 conversation（节点 id `chat`）身上，不在 LLM 节点上（ADR-0010）。
const state = loaded?.graph.nodeStates.chat?.state as
	| { history: { role: string; blocks: { type: string }[] }[] }
	| undefined;
const roles = state?.history.map((message) => message.role) ?? [];
const toolCalls =
	state?.history.flatMap((message) => message.blocks).filter((block) => block.type === "tool-call") ?? [];
console.log(`\n工作流：${(await store.ids()).join("、")}`);
console.log(`history：${roles.join("、")}；工具调用 ${toolCalls.length} 次`);

const ok = sent.length === 1 && roles.includes("tool") && roles.at(-1) === "assistant";
console.log(ok ? "✔ 端到端通了" : "✖ 链没走通");
process.exit(ok ? 0 : 1);
