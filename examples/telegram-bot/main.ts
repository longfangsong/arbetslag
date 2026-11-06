/**
 * 真的 Telegram bot：一个监听器（长轮询）→ 路由 → 每个 chat 一份工作流（relay → LLM 节点 → 真模型 → 工具 → 回话）。
 *
 * 图在 `graph.ts`；这里只接真的东西：真的模型、真的 Telegram、真的发送。
 * 密钥都从环境变量来，**不进快照**。状态在一个 SQLite 文件里（默认 `./data/telegram.db`），
 * 重启之后会话接着聊，没回来的模型调用重新交出去（ADR-0014）。
 *
 *   TELEGRAM_BOT_TOKEN=… ARBETSLAG_MODEL=… ARBETSLAG_BASE_URL=… ARBETSLAG_API_KEY=… \
 *   pnpm --filter @arbetslag/example-telegram-bot start
 */
import type { JsonValue } from "type-fest";
import { type TransitionLog, WorkflowExists, createWorkflow } from "@arbetslag/kernel";
import { createHost, createSqliteStore, createTelegramRuntime } from "@arbetslag/host-node";
import { modelPerformer } from "@arbetslag/llm";
import { createOpenAIModel } from "@arbetslag/llm/openai";
import { LISTENER, SWITCHBOARD, buildGraph } from "./graph.ts";

const env = (name: string): string => {
	const value = process.env[name];
	if (value === undefined || value === "") throw new Error(`需要环境变量 ${name}`);
	return value;
};

const model = env("ARBETSLAG_MODEL");
const baseURL = env("ARBETSLAG_BASE_URL");
const apiKey = env("ARBETSLAG_API_KEY");
const token = env("TELEGRAM_BOT_TOKEN");

const sendTelegram = async (chatId: number, text: string, signal: AbortSignal): Promise<JsonValue> => {
	const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text }),
		signal,
	});
	const payload = (await response.json()) as { ok?: boolean; description?: string };
	if (payload.ok === true) return { ok: true };
	return { ok: false, error: payload.description ?? "sendMessage failed" };
};

const log: TransitionLog = {
	append: (id, entries) => {
		for (const entry of entries) {
			if (entry.type === "transition") console.log(`   · ${id} ${entry.node} ← ${entry.messageType}`);
			else if (entry.type === "halted") console.log(`   ✖ ${id} 停住 ${entry.code}：${entry.detail}`);
		}
	},
};

const { switchboardTemplate, templates, registry } = buildGraph({
	model,
	system: "你是个简洁的助手，回答用中文，不超过三句。需要当前时间就用 clock 工具查，不要猜。",
});

const store = createSqliteStore({ file: process.env.ARBETSLAG_DB ?? "./data/telegram.db" });
const host = createHost({
	store,
	registry,
	templates,
	performers: {
		"model.complete": modelPerformer(createOpenAIModel({ apiKey, baseURL })),
		"telegram.send": async (input, { signal }) => {
			const { chatId, text } = input as { chatId: number; text: string };
			console.log(`🤖 → ${chatId}: ${text}`);
			return sendTelegram(chatId, text, signal);
		},
	},
	log,
	listeners: [{ id: LISTENER, kind: "telegram", config: {} }],
	runtimes: { telegram: createTelegramRuntime({ bots: { [LISTENER]: { token } } }) },
	retryMs: 3000,
	onUnready: (info) =>
		console.log(`   ! 未就绪 ${info.scope === "listener" ? info.listener : info.trigger}：${info.reason}（3s 后重试）`),
});

// 总机只建一次；之后每次启动都是同一份（它在文件里）。
try {
	await createWorkflow(store, registry, switchboardTemplate, { id: SWITCHBOARD });
} catch (error) {
	if (!(error instanceof WorkflowExists)) throw error;
}

const report = await host.start();
console.log(`模型 ${model}；${report.scanned} 份工作流（含总机），重交 ${report.redispatched} 个没回来的效果`);
if (host.unready().length > 0) {
	console.log("监听器没起来，见上面的未就绪原因（会继续重试）。");
} else {
	console.log("已连上 Telegram，去给 bot 发条消息吧。Ctrl-C 结束。\n");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		void host.stop().then(() => {
			store.close();
			process.exit(0);
		});
	});
}
