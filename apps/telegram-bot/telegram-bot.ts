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

import {
	Orchestrator,
	FileSystemAgentRepository,
	FileSystemTemplateRepository,
	InMemoryFileSystem,
	TelegramInputAdopter,
	type Update,
} from "arbetslag";

// Import internal classes — we build our own orchestrator to customize
// the Telegram OutputRouter (LLM decides whether to respond).
// ponytail: these imports bypass the package's dist/ export boundary;
// the built package doesn't re-export these, so we reach into src/ directly.
import { OpenAIProvider } from "../../packages/arbetslag/src/implementation/aiProvider/openai";
import { InMemoryAIProviderRepository } from "../../packages/arbetslag/src/implementation/aiProvider/inMemory";
import { InMemoryToolRepository } from "../../packages/arbetslag/src/implementation/tool/repository";
import { GetTime } from "../../packages/arbetslag/src/implementation/tool/getTime";
import { HttpRequest } from "../../packages/arbetslag/src/implementation/tool/http";
import { WebSearch } from "../../packages/arbetslag/src/implementation/tool/webSearch";

import { MemoryTool } from "./memory";
import type { FileSystem, ToolLike } from "./memory";


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

// ── Load config ─────────────────────────────────────────────────────────────

const configPath = path.join(
	path.dirname(new URL(import.meta.url).pathname),
	"arbetslag.yaml",
);
const configContent = readFileSync(configPath, "utf-8");
const config = parse(configContent) as {
	templates?: Array<{
		name: string;
		description: string;
		ai_provider: string;
		model: string;
		systemPrompt: string;
		allowedTools?: string[];
		outputSchema?: Record<string, unknown>;
		reply_threshold?: number;
	}>;
};

// ── Build dependencies ──────────────────────────────────────────────────────

const fileSystem = new InMemoryFileSystem();
const templateRepository = await FileSystemTemplateRepository.create(
	fileSystem,
	"config/templates/",
);

// Load templates from config
for (const t of config.templates ?? []) {
	await templateRepository.add({
		name: t.name,
		description: t.description,
		ai_provider: t.ai_provider,
		model: t.model,
		systemPrompt: t.systemPrompt,
		allowedTools: t.allowedTools ?? [],
		outputSchema: t.outputSchema,
	} as any);
}

// ── Custom Telegram OutputRouter ────────────────────────────────────────────

/**
 * Telegram OutputRouter that lets the LLM decide whether to respond.
 *
 * The LLM's content is a sum type — either {"reply": "text", "willingness": N} or {"no_reply": true}.
 * The router extracts the reply text or skips sending entirely based on willingness + threshold.
 *
 * Used in group chats so the bot only speaks when directly addressed.
 */
class SmartTelegramRouter {
	private readonly botToken: string;
	private readonly chatId: string;
	private readonly apiBase: string;
	private readonly replyThreshold: number;

	constructor(botToken: string, chatId: string, apiBase = "https://api.telegram.org", replyThreshold = 50) {
		this.botToken = botToken;
		this.chatId = chatId;
		this.apiBase = apiBase;
		this.replyThreshold = replyThreshold;
	}

	async route(event: { content?: string }): Promise<void> {
		const result = this._parseDecision(event.content);
		if (result === "no_reply") {
			console.log("[SmartTelegramRouter] skipped (no_reply)");
			return;
		}

		// Extract reply text from the sum type
		let text = event.content ?? "";
		if (text) {
			try {
				const parsed = JSON.parse(text);
				if (typeof parsed === "object" && parsed !== null && "reply" in parsed && typeof parsed.reply === "string") {
					text = parsed.reply;
				}
			} catch {
				// Not JSON — use content as-is (plain text reply)
			}
		}

		console.log(
			`[SmartTelegramRouter] chatId=${this.chatId}, content_len=${text.length}, threshold=${this.replyThreshold}`,
		);
		console.log(
			`[SmartTelegramRouter] content_preview="${text.slice(0, 200)}"`,
		);

		const res = await fetch(
			`${this.apiBase}/bot${this.botToken}/sendRichMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: this.chatId,
					rich_message: { markdown: text },
				}),
			},
		);
		if (!res.ok) {
			const body = await res.text();
			console.log(`[SmartTelegramRouter] ❌ error: ${res.status} ${body}`);
			throw new Error(`Telegram API error: ${res.status} ${body}`);
		}
		console.log(`[SmartTelegramRouter] ✅ sent OK`);
	}

	/**
	 * Parse LLM output as a sum type from content string:
	 *   {"reply": "text", "willingness": N}  → "reply" if willingness >= threshold
	 *   {"no_reply": true}                   → "no_reply" (skip)
	 *   plain text                           → "reply" (backward compat)
	 */
	private _parseDecision(content?: string): "reply" | "no_reply" {
		console.log(`[SmartTelegramRouter] content="${content}"`);
		if (!content) return "reply";

		try {
			const parsed = JSON.parse(content);
			if (typeof parsed === "object" && parsed !== null) {
				if ("reply" in parsed && typeof parsed.reply === "string") {
					const reply_willingness = (parsed as { reply_willingness?: number }).reply_willingness;
					if (reply_willingness !== undefined && reply_willingness < this.replyThreshold) {
						console.log(`[SmartTelegramRouter] skipped (reply_willingness=${reply_willingness} < threshold=${this.replyThreshold})`);
						return "no_reply";
					}
					return "reply";
				}
			}
		} catch {
			// Not JSON — treat as plain text reply
		}
		return "reply";
	}
}

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

// ── Process a Telegram update ───────────────────────────────────────────────

async function processUpdate(update: Update): Promise<void> {
	const adopter = new TelegramInputAdopter();
	const messageEvent = adopter.convert(update);
	if (!messageEvent) {
		console.log("[webhook] Converted to null, skipping");
		return;
	}

	console.log(
		`[webhook] Chat ${messageEvent.chat_id}: "${messageEvent.content}"`,
	);

	// Build orchestrator with custom OutputRouter.
	// Uses `any` because internal classes from src/ have separate type
	// instances from the built package — runtime is fine, tsc isn't.
	const outputRouter = new SmartTelegramRouter(
		TELEGRAM_BOT_TOKEN,
		messageEvent.chat_id,
		undefined,
		config.templates?.[0]?.reply_threshold ?? 50,
	);

	const deps: any = {
		fileSystem,
		agentRepository: await FileSystemAgentRepository.create(
			fileSystem,
			"agents/",
		),
		templateRepository,
		toolRepository: new InMemoryToolRepository([
			new GetTime(),
			new HttpRequest(),
			...(process.env.SEARXNG_URL
				? [
						new WebSearch(
							process.env.SEARXNG_URL,
							30000,
							10,
						),
					]
				: []),
			new MemoryTool(),
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
	orchestrator.push(messageEvent);
	await orchestrator.stepUntilIdle();
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const app = new Hono();

// Telegram 在 setWebhook 时发 GET 验证 webhook 可达性，需返回 200
app.get("/webhook", (c) => c.text("OK"));

app.post("/webhook", async (c) => {
	const update = await c.req.json();
	processUpdate(update as Update).catch(console.error);
	return c.text("OK");
});

app.get("/health", (c) => c.text("OK"));

// ── Start ───────────────────────────────────────────────────────────────────

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
		console.log(`   Listening on port ${info.port}\n`);
	});
}

process.on("SIGINT", async () => {
	console.log("\n🗑️  Deleting webhook and shutting down...");
	await deleteWebhook();
	process.exit(0);
});

start().catch((err) => {
	console.error("Startup failed:", err);
	process.exit(1);
});
