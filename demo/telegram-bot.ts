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
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
	InMemoryFileSystem,
	OutputHandlerRegistry,
	TelegramOutputHandler,
	onUserMessage,
	serialize,
	GetTime,
	HttpRequest,
	SendTelegramMessage,
	ListTemplates,
	Spawn,
	loadConfig,
	registerTool,
	createConfig,
	createState,
	type Update,
	type Config,
	type MutableState as State,
	TelegramInputAdopter,
} from "arbetslag";

// ── Config ──────────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const WEBHOOK_URL = process.env.WEBHOOK_URL!;
const PORT = Number(process.env.PORT ?? 3000);

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

// ── Build Config ────────────────────────────────────────────────────────────

// Register tools so loadConfig can resolve them by name
registerTool("getTime", () => new GetTime());
registerTool("httpRequest", () => new HttpRequest());
registerTool("sendTelegramMessage", () => new SendTelegramMessage());
registerTool("listTemplates", () => new ListTemplates());
registerTool("spawn", () => new Spawn());

// Load providers, tools, and templates from config file
const configPath = path.join(path.dirname(new URL(import.meta.url).pathname), "arbetslag.yaml");
const loadedConfig = await loadConfig(configPath);

const fileSystem = new InMemoryFileSystem();
const outputHandlerRegistry = new OutputHandlerRegistry();

const config: Config = createConfig(loadedConfig, fileSystem, outputHandlerRegistry, {
	telegram_bot_token: TELEGRAM_BOT_TOKEN,
});

// ── Build State ─────────────────────────────────────────────────────────────

let state: State = createState();

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
		console.log(`   Config: ${configPath}`);
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
