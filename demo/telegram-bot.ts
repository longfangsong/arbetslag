#!/usr/bin/env tsx
/**
 * Telegram bot demo for arbetslag — webhook mode.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=<token> OPENAI_API_KEY=<key> WEBHOOK_URL=<url> npx tsx demo/telegram-bot.ts
 *
 * WEBHOOK_URL is the public HTTPS URL where Telegram will send updates
 * (e.g. https://abc.ngrok.io/webhook). For local testing, use ngrok or similar.
 *
 * Optionally set OPENAI_BASE_URL for OpenAI-compatible endpoints (e.g. Ollama).
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
	AgentRepository,
	AgentTemplateRepository,
	ChatRepository,
	InMemoryFileSystem,
	OpenAIProvider,
	OutputHandlerRegistry,
	ToolRepository,
	TelegramOutputHandler,
	onUserMessage,
	serialize,
	GetTime,
	HttpRequest,
	SendTelegramMessage,
	ListTemplates,
	Spawn,
	type Update,
	type Config,
	type MutableState as State,
	type Template,
	TelegramInputAdopter,
} from "arbetslag";

// ── Config ──────────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL; // optional, for Ollama etc.
const WEBHOOK_URL = process.env.WEBHOOK_URL!;
const PORT = Number(process.env.PORT ?? 3000);


if (!TELEGRAM_BOT_TOKEN) {
	console.error("❌  Set TELEGRAM_BOT_TOKEN environment variable.");
	process.exit(1);
}
if (!OPENAI_API_KEY) {
	console.error("❌  Set OPENAI_API_KEY environment variable.");
	process.exit(1);
}
if (!WEBHOOK_URL) {
	console.error(
		"❌  Set WEBHOOK_URL environment variable (e.g. https://abc.ngrok.io/webhook).",
	);
	process.exit(1);
}

// ── Build Config ────────────────────────────────────────────────────────────

const fileSystem = new InMemoryFileSystem();
const agentTemplateRepository = new AgentTemplateRepository();
const toolRepository = new ToolRepository();
const outputHandlerRegistry = new OutputHandlerRegistry();

// Register tools
toolRepository.tools.push(new GetTime());
toolRepository.tools.push(new HttpRequest());
toolRepository.tools.push(new SendTelegramMessage());
toolRepository.tools.push(new ListTemplates());
toolRepository.tools.push(new Spawn());

// Register AI provider
const aiProvider = new OpenAIProvider({
	baseUrl: OPENAI_BASE_URL,
	apiKey: OPENAI_API_KEY,
	name: "openai-compatible",
});

// Register default template
const defaultTemplate: Template = {
	name: "default",
	description: "General-purpose assistant",
	ai_provider: "openai-compatible",
	model: process.env.MODEL_NAME ?? "gpt-4o",
	systemPrompt:
		"You are a helpful assistant. Answer the user's questions concisely and accurately.",
	allowedTools: ["getTime", "httpRequest", "sendTelegramMessage"],
};
await agentTemplateRepository.add(defaultTemplate);

const config: Config = {
	aiProviders: [aiProvider],
	agentTemplateRepository,
	toolRepository,
	config: {
		telegram_bot_token: TELEGRAM_BOT_TOKEN,
	},
	fileSystem,
	outputHandlerRegistry,
};

// ── Build State ─────────────────────────────────────────────────────────────

let state: State = {
	agentRepository: new AgentRepository(),
	chatRepository: new ChatRepository(),
	eventQueue: [],
	toolState: {},
};

// ── Webhook helpers ─────────────────────────────────────────────────────────

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

async function processUpdate(update: Update): Promise<void> {
	const adopter = new TelegramInputAdopter();
	const messageEvent = adopter.convert(update);
	console.log(`📨 Received update: ${JSON.stringify(messageEvent)}`);
	if (!messageEvent) return;

	// Register output handler for this chat (re-use if already registered)
	if (
		!outputHandlerRegistry.get(messageEvent.adapter, messageEvent.chat_id)
	) {
		outputHandlerRegistry.register(
			messageEvent.adapter,
			messageEvent.chat_id,
			new TelegramOutputHandler(
				messageEvent.adapter,
				messageEvent.chat_id,
				TELEGRAM_BOT_TOKEN,
			),
		);
		console.log(`🎯 Registered output handler for chat ${messageEvent.chat_id}`);
	}

	// Process the message through the orchestrator
	try {
		const chat = {
			id: messageEvent.chat_id,
			entry_agent_id: "",
		};
		await onUserMessage(config, state, chat, messageEvent.payload.content, messageEvent.adapter);
	} catch (err) {
		console.error(
			`Error processing message from ${messageEvent.chat_id}:`,
			err,
		);
	}
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const app = new Hono();

// Webhook endpoint — Telegram POSTs updates here
app.post("/webhook", async (c) => {
	const update = await c.req.json();
	processUpdate(update as Update).catch(console.error);

	return c.text("OK");
});

// Health check
app.get("/health", (c) => c.text("OK"));

// ── Start ───────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
	// Set webhook with Telegram
	try {
		await setWebhook(WEBHOOK_URL + "/webhook");
	} catch (err) {
		console.error("Failed to register webhook:", err);
		console.log(
			"⚠️  The webhook may already be set. You can delete it with: curl -X POST https://api.telegram.org/bot<token>/deleteWebhook",
		);
	}

	// Start HTTP server
	serve({ fetch: app.fetch, port: PORT }, (info) => {
		console.log("🤖 arbetslag Telegram bot starting...");
		console.log(`   Model: ${process.env.MODEL_NAME ?? "gpt-4o"}`);
		if (OPENAI_BASE_URL) console.log(`   Base URL: ${OPENAI_BASE_URL}`);
		console.log(`   Webhook: ${WEBHOOK_URL}`);
		console.log(`   Listening on port ${info.port}\n`);
	});
}

// Handle Ctrl+C gracefully
process.on("SIGINT", async () => {
	console.log("\n🗑️  Deleting webhook and shutting down...");
	await deleteWebhook();
	console.log("📦 Serializing state...");
	await serialize(config, state);
	process.exit(0);
});

start().catch((err) => {
	console.error("Startup failed:", err);
	process.exit(1);
});
