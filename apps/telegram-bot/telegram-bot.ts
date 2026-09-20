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
	type ApiCallbackEvent,
	type CompactRequest,
	GetTime,
	ReadFile,
	FetchWebPage,
	WebSearch,
	CronCreate,
	CronDelete,
	SimpleMemoryRead,
	SimpleMemoryUpdate,
	type OrchestratorDeps,
	type Template,
	type Update,
	type ContentPart,
	type Content,
	contentText,
} from "arbetslag";
import { UpdateBatcher } from "./batcher";
import { STICKERS } from "./prompt/sticker";
import { PINS } from "./prompt/pin";
import { buildSystemPrompt } from "./prompt";
import { format } from "date-fns/format";
import { SmartTelegramRouter } from "./telegram-router";
import { log, error } from "./logger";

const FLUSH_QUIET_MS = 5_000;
const CONTEXT_IDLE_RESET_MS = 4 * 60 * 60 * 1000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const WEBHOOK_URL = process.env.WEBHOOK_URL!;
const PORT = Number(process.env.PORT ?? 3000);
const APP_DIR = path.dirname(new URL(import.meta.url).pathname);

if (!TELEGRAM_BOT_TOKEN) {
	error("❌  Set TELEGRAM_BOT_TOKEN environment variable.");
	process.exit(1);
}
if (!WEBHOOK_URL) {
	error(
		"❌  Set WEBHOOK_URL environment variable (e.g. https://abc.ngrok.io/webhook).",
	);
	process.exit(1);
}

const configPath = path.join(APP_DIR, "arbetslag.yaml");
const configContent = readFileSync(configPath, "utf-8");
const config = parse(configContent) as {
  username?: string;
  templates?: Array<Template>;
};

const fileSystem = new NodeFileSystem(path.join(APP_DIR, "data"));
const templateRepository = await FileSystemTemplateRepository.create(
	fileSystem,
	"config/templates/",
);

// Generate the system prompt (base + sticker capability).
const systemPrompt = buildSystemPrompt(config.username || "bot", config.templates![0].model, STICKERS, PINS);

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

/** One item queued per chat: everything is a domain event. */
type ChatInput = MessageEvent | ApiCallbackEvent;

function contentForLog(content: Content): string {
	return content
		.map((p) => (p.type === "image" ? "[[image]]" : p.text))
		.join(" ");
}

/**
 * Flatten one batcher item into LLM-visible parts. Keeps the structured
 * parts produced by the Input Adopter as-is — the leading text part
 * already carries the `[sender]: ` signature and any <reply_to> block —
 * and only prepends the batcher-level timestamp. Timestamps double as
 * message boundaries when a batch holds several items.
 */
function formatInputParts(input: ChatInput): Array<ContentPart> {
	if (input.event_type === "api_callback") {
		return [
			{
				type: "text",
				text: `<api_callback>\n<id>${input.id}</id>\n<api_name>${input.api_name}</api_name>\n<payload>\n${input.content}\n</payload>\n</api_callback>`,
			},
		];
	}
	const time = format(new Date(input.send_time), "HH:mm:ss");
	const parts: Array<ContentPart> = [...input.content];
	const [first, ...rest] = parts;
	if (first && first.type === "text") {
		return [{ type: "text", text: `[${time}] ${first.text}` }, ...rest];
	}
	return [{ type: "text", text: `[${time}] ` }, ...parts];
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
	log(`✅ Webhook registered: ${url}`);
}

async function setMyCommands(): Promise<void> {
	const res = await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				commands: [
					{
						command: "compact",
						description: "Compress this chat's history to free context",
					},
				],
			}),
		},
	);
	const data = (await res.json()) as { ok: boolean; description?: string };
	if (!data.ok) {
		throw new Error(`Failed to set commands: ${data.description}`);
	}
	log("✅ Commands registered: /compact");
}

async function deleteWebhook(): Promise<void> {
	await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`,
		{ method: "POST" },
	);
	log("🗑️  Webhook deleted.");
}

// ── Process a Telegram update ───────────────────────────────────────────────
const inputAdopter = new TelegramInputAdopter(TELEGRAM_BOT_TOKEN);
const lastActive = new Map<string, number>();
const printedHistory = new Map<string, number>();
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
		.catch(error)
		.finally(() => {
			chainBusy = false;
		});
});

function handleUpdate(update: Update): Promise<void> {
	return inputAdopter.convert(update).then((event) => {
		if (!event) return;
		batcher.enqueue(event.chat_id, event);
	});
}

async function processChatBatch(
	chatId: string,
	inputs: ChatInput[],
	stale: boolean,
): Promise<void> {
	const agentRepository = await FileSystemAgentRepository.create(
		fileSystem,
		"agents/",
	);
	const agent = await agentRepository.getByChatId(chatId);

	if (stale && agent && agent.history.length > 0) {
		log(`[context] chat ${chatId} idle > 4h — new context window`);
		agent.history = [];
		await agentRepository.save(agent);
		printedHistory.set(chatId, 0);
	}

	// Callbacks ride the bus as api_callback events (Agent.handleApiCallback
	// renders them into history, jobId in <id> for delete_cron). If no agent
	// exists yet they fall back to text lines in the message, whose dispatch
	// creates the default agent.
	const callbacks = inputs.filter((i): i is ApiCallbackEvent => i.event_type === "api_callback");
	// /compact is a user command, not LLM input: route it as compact_request.
	// The message content now leads with the adapter's `[sender]: ` signature
	// and possibly a <reply_to> block, so strip both before comparing.
	const userCommandText = (i: ChatInput) => {
		if (i.event_type !== "message") return "";
		const all = contentText(i.content).replace(/^\[[^\]]+\]: /, "");
		return all.replace(/<reply_to[\s\S]*?<\/reply_to>\n?/, "").trim();
	};
	const isCompactCommand = (i: ChatInput) => userCommandText(i) === "/compact";
	const hasCompactCommand = inputs.some(isCompactCommand);
	let messageInputs: Array<MessageEvent> | Array<ChatInput> = agent
		? inputs.filter(
				(i): i is MessageEvent =>
					i.event_type === "message" && !isCompactCommand(i),
			)
		: inputs.filter((i): i is ChatInput => !isCompactCommand(i));
	const firstMessage = messageInputs.find(
		(i): i is MessageEvent => i.event_type === "message",
	);
	let event: MessageEvent | null = null;
	if (messageInputs.length > 0) {
		event =
			firstMessage !== undefined
				? firstMessage
				: {
					id: randomUUID(),
					event_type: "message",
					chat_id: chatId,
					adapter: "system",
					content: [],
					send_time: Date.now(),
				};
		event.content = messageInputs.flatMap(formatInputParts);
	}

	// Build orchestrator with custom OutputRouter.
	const outputRouter = new SmartTelegramRouter(
		TELEGRAM_BOT_TOKEN,
		chatId
	);

	const tools = [
		new GetTime(),
		new ReadFile(),
		new FetchWebPage(),
		...(process.env.SEARXNG_URL
			? [
				new WebSearch(
					process.env.SEARXNG_URL,
					30000,
					10
				),
			]
			: []),
		new SimpleMemoryRead(),
		new SimpleMemoryUpdate(),
		...(process.env.CRON_JOB_API_KEY
			? [
				new CronCreate(
					process.env.CRON_JOB_API_KEY,
					`${WEBHOOK_URL}/cron`,
					TELEGRAM_BOT_TOKEN
				),
				new CronDelete(process.env.CRON_JOB_API_KEY),
			]
			: []),
	];
	const deps: OrchestratorDeps = {
		fileSystem,
		agentRepository,
		templateRepository,
		toolRepository: new InMemoryToolRepository(tools),
		aiProviderRepository: new InMemoryAIProviderRepository([
			new OpenAIProvider(
				process.env.OPENAI_API_KEY!,
				process.env.OPENAI_BASE_URL,
			),
		]),
		outputRouter,
	};

	const orchestrator = new Orchestrator(deps);
	// A pending Wait is history, not queue state: resolve any Wait that is still
	// open against Reports that arrived while the program was down.
	await orchestrator.resolveOpenWaits();
	if (event) orchestrator.push(event);
	if (hasCompactCommand) {
		orchestrator.push({
			id: randomUUID(),
			event_type: "compact_request",
			chat_id: chatId,
		});
	}
	if (agent) {
		for (const cb of callbacks) {
			orchestrator.push({ ...cb, to_agent_id: agent.id });
		}
	}
	const result = await orchestrator.stepUntilIdle();
	result.match(
		() => undefined,
		(e) => {
			// Fail fast at the app boundary: state is already checkpointed on
			// disk, so a crash here loses nothing and a restart resumes.
			error(`[Orchestrator] ${e}`);
			throw new Error(`Orchestrator failed: ${e}`);
		},
	);

	const updatedAgent = await agentRepository.getByChatId(chatId);
	if (updatedAgent) {
		const prev = printedHistory.get(chatId) ?? 0;
		if (updatedAgent.history.length > prev) {
			for (const [i, h] of updatedAgent.history.entries()) {
				if (i < prev) continue;
				const extra =
					h.role === "assistant" && h.tool_calls
						? ` tool_calls=[${h.tool_calls.map((t) => `${t.tool_name}(${JSON.stringify(t.arguments)})`).join(", ")}]`
						: "";
				const rendered =
					h.role === "tool" || h.role === "assistant"
						? h.content
						: contentForLog(h.content);
				log(`[${i}] ${h.role}: ${rendered.slice(0, 500)}${extra}`);
			}
			printedHistory.set(chatId, updatedAgent.history.length);
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
	batcher.enqueue(chat, { id: job, event_type: "api_callback", api_name: "cron", content: text });
	return c.text("OK");
});

app.post("/webhook", async (c) => {
  const update = await c.req.json();
	if (process.env.TEST_MODE === "true" || process.env.TEST_MODE === "1") {
		log(`    [webhook] received update: ${JSON.stringify(update)}`);
	}
	await handleUpdate(update as Update);
	return c.text("OK");
});

app.get("/health", (c) => c.text("OK"));

async function start(): Promise<void> {
	try {
		await setWebhook(WEBHOOK_URL + "/webhook");
		await setMyCommands();
	} catch (err) {
		error("Failed to register webhook:", err);
		log("⚠️  Webhook may already be set.");
	}

	serve({ fetch: app.fetch, port: PORT }, (info) => {
		log("🤖 arbetslag Telegram bot starting...");
		log(`   Config: ${configPath}`);
		log(`   Webhook: ${WEBHOOK_URL}`);
		log(`   Listening on port ${info.port}\n`);
	});
}

process.on("SIGINT", async () => {
	log("\n🗑️  Flushing pending messages and shutting down...");
	shuttingDown = true;
	batcher.flushNow();
	await chain;
	await deleteWebhook();
	process.exit(0);
});

start().catch((err) => {
	error("Startup failed:", err);
	process.exit(1);
});
