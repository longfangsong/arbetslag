#!/usr/bin/env tsx
/**
 * Telegram bot demo for arbetslag — webhook mode.
 *
 * Uses a custom orchestrator setup so the Telegram OutputRouter can
 * inspect LLM output and decide whether to actually send a message.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=<token> OPENAI_API_KEY=<key> WEBHOOK_URL=<url> pnpm demo:telegram
 */

import "dotenv/config";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

import {
	Orchestrator,
	FileSystemAgentRepository,
	FileSystemTemplateRepository,
	NodeFileSystem,
	TelegramInputAdopter,
	OpenAIProvider,
	InMemoryAIProviderRepository,
	InMemoryToolRepository,
	type MessageEvent,
	GetTime,
	ReadFile,
	FetchWebPage,
	WebSearch,
	CronCreate,
	CronDelete,
	type OrchestratorDeps,
	type Template,
	type Update,
} from "arbetslag";

import { MemoryRead, MemoryUpdate } from "./memory";
import { UpdateBatcher } from "./batcher";
import { STICKERS } from "./prompt/sticker";
import { PINS } from "./prompt/pin";
import { buildSystemPrompt } from "./prompt";
import { format } from "date-fns/format";

const FLUSH_QUIET_MS = 4_000;
const CONTEXT_IDLE_RESET_MS = 6 * 60 * 60 * 1000;


const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const WEBHOOK_URL = process.env.WEBHOOK_URL!;
const PORT = Number(process.env.PORT ?? 3000);
// 测试模式：完整跑 LLM + 输出 history/log，但最后不实际发送到 Telegram
const TEST_MODE = process.env.TEST_MODE === "1" || process.env.TEST_MODE === "true";

if (!TELEGRAM_BOT_TOKEN) {
	console.error("❌  Set TELEGRAM_BOT_TOKEN environment variable.");
	process.exit(1);
}
if (!WEBHOOK_URL) {
	console.error(
		"❌  Set WEBHOOK_URL environment variable (e.g. https://abc.ngrok.io/webhook).",
	);
	process.exit(1);
}

const APP_DIR = path.dirname(new URL(import.meta.url).pathname);

const configPath = path.join(APP_DIR, "arbetslag.yaml");
const configContent = readFileSync(configPath, "utf-8");

const config = parse(configContent) as {
	templates?: Array<Template>;
};

const fileSystem = new NodeFileSystem(path.join(APP_DIR, "data"));
const templateRepository = await FileSystemTemplateRepository.create(
	fileSystem,
	"config/templates/",
);

// Generate the system prompt (base + sticker capability).
const systemPrompt = buildSystemPrompt(STICKERS, PINS);

// Load templates from config
for (const t of config.templates ?? []) {
	await templateRepository.add({
		name: t.name,
		description: t.description,
		ai_provider: t.ai_provider,
		model: t.model,
		systemPrompt,
		allowedTools: t.allowedTools ?? [],
		outputSchema: t.outputSchema,
	});
}

class SmartTelegramRouter {
	private readonly botToken: string;
	private readonly chatId: string;

	constructor(botToken: string, chatId: string) {
		this.botToken = botToken;
		this.chatId = chatId;
	}

	async route({ content }: { content?: string }): Promise<void> {
		content = content?.trim();
		if (!content || content === '""' || content === "''") {
			console.log(`[SmartTelegramRouter] No content to send`);
			return;
		}

		const stickerTokens = [
			...content.matchAll(/\[\[sticker:([a-zA-Z0-9_-]+)\]\]/g),
		].map((m) => m[1]);
		const pin = PINS.find((p) =>
			content.includes(`[[pin:${p.id}]]`),
		);
		let text = content
			.replace(/\[\[sticker:[a-zA-Z0-9_-]+\]\]/g, "")
			.replace(/\[\[pin:[a-zA-Z0-9_-]+\]\]/g, "！")
			.trim();
		if (pin) {
			console.log(
				`[SmartTelegramRouter] quoting pinned message ${pin.id} (#${pin.messageId})`,
			);
		}

		if (stickerTokens.length === 0 && !text) {
			console.log(`[SmartTelegramRouter] No content to send`);
			return;
		}

		console.log(
			`[SmartTelegramRouter] Sending to chat ${this.chatId}: ${text || "(sticker only)"}${stickerTokens.length ? ` + sticker(s): ${stickerTokens.join(", ")}` : ""}`,
		);

		if (TEST_MODE) {
			return;
		}

		if (text) {
			const webhookUrl = `https://api.telegram.org/bot${this.botToken}/sendRichMessage`;
			const res = await fetch(webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: this.chatId,
					rich_message: { markdown: text },
					...(pin ? { reply_to_message_id: pin.messageId } : {}),
				}),
			});
			if (!res.ok) {
				const body = await res.text();
				console.log(`[SmartTelegramRouter] error: ${res.status} ${body}`);
				throw new Error(`Telegram API error: ${res.status} ${body}`);
			}
		}

		for (const id of stickerTokens) {
			const sticker = STICKERS.find((s) => s.id === id);
			if (!sticker) {
				console.warn(`[SmartTelegramRouter] unknown sticker id: ${id}`);
				continue;
			}
			const res = await fetch(
				`https://api.telegram.org/bot${this.botToken}/sendSticker`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ chat_id: this.chatId, sticker: sticker.fileId }),
				},
			);
			if (!res.ok) {
				const body = await res.text();
				console.log(`[SmartTelegramRouter] sendSticker error: ${res.status} ${body}`);
			}
		}
	}
}

function formatChatLine(update: Update, event: { content: string; sender?: string }): string {
	const msg =
		update.message ??
		update.edited_message ??
		update.channel_post ??
		update.edited_channel_post;
	const ts = new Date(msg?.date! * 1000);
	const time = format(ts, "HH:mm:ss");
	return `[${time}] ${event.sender ?? "user"}: ${event.content}`;
}

/** One item queued per chat: a Telegram update, or a system callback. */
type ChatInput =
	| { kind: "update"; update: Update }
	| { kind: "callback"; type: string; id: string; text: string };

function formatInputLine(input: ChatInput): string {
	if (input.kind === "callback") {
		return `<callback><type>${input.type}</type><id>${input.id}</id><payload>${input.text}</payload></callback>`;
	}
	const event = new TelegramInputAdopter().convert(input.update)!;
	return formatChatLine(input.update, event);
}

async function setWebhook(url: string): Promise<void> {
	const res = await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url,
				allowed_updates: [
					"message",
					"edited_message",
					"channel_post",
					"edited_channel_post",
				],
			}),
		},
	);
	const data = (await res.json()) as { ok: boolean; description?: string };
	if (!data.ok) {
		throw new Error(`Failed to set webhook: ${data.description}`);
	}
	console.log(`✅ Webhook registered: ${url}`);
}

async function deleteWebhook(): Promise<void> {
	await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`,
		{ method: "POST" },
	);
	console.log("🗑️  Webhook deleted.");
}

// ── Process a Telegram update ───────────────────────────────────────────────
const lastActive = new Map<string, number>();
let chain: Promise<void> = Promise.resolve();
let chainBusy = false;
let shuttingDown = false;
const batcher = new UpdateBatcher<ChatInput>(FLUSH_QUIET_MS, (chatId, inputs) => {
	if (chainBusy && !shuttingDown) {
		// LLM is still busy: keep buffering in the batcher (re-debounced) instead
		// of starting another LLM request right away.
		for (const input of inputs) batcher.enqueue(chatId, input);
		return;
	}
	const prev = lastActive.get(chatId);
	const now = Date.now();
	lastActive.set(chatId, now);
	const stale = prev !== undefined && now - prev >= CONTEXT_IDLE_RESET_MS;
	chainBusy = true;
	chain = chain
		.then(() => processChatBatch(chatId, inputs, stale))
		.catch(console.error)
		.finally(() => {
			chainBusy = false;
		});
});

function handleUpdate(update: Update): void {
	const event = new TelegramInputAdopter().convert(update);
	if (!event) return;
	batcher.enqueue(event.chat_id, { kind: "update", update });
}

async function processChatBatch(
	chatId: string,
	inputs: ChatInput[],
	stale: boolean,
): Promise<void> {
	const firstUpdate = inputs.find((i) => i.kind === "update")?.update;
	const event: MessageEvent =
		firstUpdate !== undefined
			? new TelegramInputAdopter().convert(firstUpdate)!
			: {
				id: randomUUID(),
				event_type: "message",
				chat_id: chatId,
				adapter: "system",
				content: "",
			};
	event.content = inputs.map(formatInputLine).join("\n");

	const agentRepository = await FileSystemAgentRepository.create(
		fileSystem,
		"agents/",
	);

	if (stale) {
		const agent = await agentRepository.getByChatId(chatId);
		if (agent && agent.history.length > 0) {
			console.log(`[context] chat ${chatId} idle > 6h — new context window`);
			agent.history = [];
			await agentRepository.save(agent);
		}
	}

	// Build orchestrator with custom OutputRouter.
	const outputRouter = new SmartTelegramRouter(
		TELEGRAM_BOT_TOKEN,
		chatId
	);

	const deps: OrchestratorDeps = {
		fileSystem,
		agentRepository,
		templateRepository,
		toolRepository: new InMemoryToolRepository([
			new GetTime(),
			new ReadFile(),
			new FetchWebPage(),
			...(process.env.SEARXNG_URL
				? [
					new WebSearch(
						process.env.SEARXNG_URL,
						30000,
						10,
					),
				]
				: []),
			new MemoryRead(),
			new MemoryUpdate(),
			...(process.env.CRON_JOB_API_KEY
				? [
					new CronCreate(
						process.env.CRON_JOB_API_KEY,
						`${WEBHOOK_URL}/cron`,
						TELEGRAM_BOT_TOKEN,
					),
					new CronDelete(process.env.CRON_JOB_API_KEY),
				]
				: []),
		]),
		aiProviderRepository: new InMemoryAIProviderRepository([
			new OpenAIProvider(
				process.env.OPENAI_API_KEY!,
				process.env.OPENAI_BASE_URL,
			),
		]),
		outputRouter,
	};

	const orchestrator = new Orchestrator(deps);
	orchestrator.push(event);
	console.log(`[processChatBatch] chat ${chatId} processing ${event.content}`);
	await orchestrator.stepUntilIdle();

	const agent = await agentRepository.getByChatId(chatId);
	if (agent) {
		console.log(`🧪 [TEST_MODE] chat ${chatId} history (${agent.history.length} entries):`);
		for (const [i, h] of agent.history.entries()) {
			const extra =
				h.role === "assistant" && h.tool_calls
					? ` tool_calls=[${h.tool_calls.map((t) => t.tool_name).join(", ")}]`
					: "";
			console.log(`  [${i}] ${h.role}: ${String(h.content ?? "").slice(0, 500)}${extra}`);
		}
	}
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const app = new Hono();

app.get("/webhook", (c) => c.text("OK"));

// cron-job.org callback: verifies the HMAC signature, then delivers the job's
// message to the chat the job was created in.
app.get("/cron", async (c) => {
	const chat = c.req.query("chat") ?? "";
	const job = c.req.query("job") ?? "";
	const text = c.req.query("text")?.trim() ?? "";
	const sig = c.req.query("sig") ?? "";
	if (!/^\d+$/.test(chat) || !/^\d+$/.test(job) || !text) {
		return c.text("bad request", 400);
	}
	const expected = createHmac("sha256", TELEGRAM_BOT_TOKEN)
		.update(`${chat}|${job}|${text}`)
		.digest();
	const given = Buffer.from(sig, "hex");
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		return c.text("bad signature", 401);
	}
	// Feed the callback through the normal pipeline as a first-class batcher
	// item; the LLM sees it with the chat's full history and decides what to do.
	// `text` is the payload the LLM itself chose when scheduling the job,
	// `job` is its cron-job.org ID (so it can delete one-off jobs afterwards).
	batcher.enqueue(chat, { kind: "callback", type: "cron", id: job, text });
	return c.text("OK");
});

app.post("/webhook", async (c) => {
	const update = await c.req.json();
	handleUpdate(update as Update);
	return c.text("OK");
});

app.get("/health", (c) => c.text("OK"));

async function start(): Promise<void> {
	try {
		await setWebhook(WEBHOOK_URL + "/webhook");
	} catch (err) {
		console.error("Failed to register webhook:", err);
		console.log("⚠️  Webhook may already be set.");
	}

	serve({ fetch: app.fetch, port: PORT }, (info) => {
		console.log("🤖 arbetslag Telegram bot starting...");
		console.log(`   Config: ${configPath}`);
		console.log(`   Webhook: ${WEBHOOK_URL}`);
		console.log(`   Mode: ${TEST_MODE ? "🧪 TEST (no real sends)" : "live"}`);
		console.log(`   Listening on port ${info.port}\n`);
	});
}

process.on("SIGINT", async () => {
	console.log("\n🗑️  Flushing pending messages and shutting down...");
	shuttingDown = true;
	batcher.flushNow();
	await chain;
	await deleteWebhook();
	process.exit(0);
});

start().catch((err) => {
	console.error("Startup failed:", err);
	process.exit(1);
});
