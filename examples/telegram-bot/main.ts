/**
 * 真的 Telegram bot：`telegram` 触发器（长轮询）→ relay → agent → 真模型 → 工具 → 回话。
 *
 * 图在 `graph.ts`；这里只接真的东西：真的模型、真的 Telegram、真的发送。
 * 密钥都从环境变量来，**不进快照**。
 *
 *   TELEGRAM_BOT_TOKEN=… ARBETSLAG_MODEL=… ARBETSLAG_BASE_URL=… ARBETSLAG_API_KEY=… \
 *   pnpm --filter @arbetslag/example-telegram-bot start
 */
import type { JsonValue } from "type-fest";
import { type TransitionLog, createMemoryStore, createWorkflow } from "@arbetslag/kernel";
import { createHost, createTelegramRuntime } from "@arbetslag/host-node";
import { modelPerformer } from "@arbetslag/llm";
import { createOpenAIModel } from "@arbetslag/llm/openai";
import { buildGraph } from "./graph.ts";

const env = (name: string): string => {
	const value = process.env[name];
	if (value === undefined || value === "") throw new Error(`需要环境变量 ${name}`);
	return value;
};

const model = env("ARBETSLAG_MODEL");
const baseURL = env("ARBETSLAG_BASE_URL");
const apiKey = env("ARBETSLAG_API_KEY");
const token = env("TELEGRAM_BOT_TOKEN");

const sendTelegram = async (chatId: number, text: string): Promise<JsonValue> => {
	const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text }),
	});
	const payload = (await response.json()) as { ok?: boolean; description?: string };
	if (payload.ok === true) return { ok: true };
	return { ok: false, error: payload.description ?? "sendMessage failed" };
};

const log: TransitionLog = {
	append: (_id, entries) => {
		for (const entry of entries) {
			if (entry.type === "transition") console.log(`   · ${entry.node} ← ${entry.messageType}`);
			else if (entry.type === "halted") console.log(`   ✖ 停住 ${entry.code}：${entry.detail}`);
		}
	},
};

const { template, registry } = buildGraph({
	model,
	system: "你是个简洁的助手，回答用中文，不超过三句。需要当前时间就用 clock 工具查，不要猜。",
});

const store = createMemoryStore();
const host = createHost({
	store,
	registry,
	performers: {
		"model.complete": modelPerformer(createOpenAIModel({ apiKey, baseURL })),
		"telegram.send": async (input) => {
			const { chatId, text } = input as { chatId: number; text: string };
			console.log(`🤖 → ${chatId}: ${text}`);
			return sendTelegram(chatId, text);
		},
	},
	log,
	triggers: {
		runtimes: { telegram: createTelegramRuntime({ token }) },
		retryMs: 3000,
		onUnready: (info) => console.log(`   ! 未就绪 ${info.trigger}：${info.reason}（3s 后重试）`),
	},
});

const { id } = await createWorkflow(store, registry, template, { id: "tg" });
console.log(`模型 ${model}；工作流 ${id}`);
await host.triggers?.reconcile(id);
const running = host.triggers?.running(id) ?? [];
if (running.length === 0) {
	console.log("触发器没起来，见上面的未就绪原因。");
	process.exitCode = 1;
} else {
	console.log(`已连上 Telegram（${running.join("、")}），去给 bot 发条消息吧。Ctrl-C 结束。\n`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		void host.triggers?.stop().then(() => process.exit(0));
	});
}
