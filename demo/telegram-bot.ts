#!/usr/bin/env tsx
/**
 * Telegram bot demo for arbetslag — webhook mode.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=<token> OPENAI_API_KEY=<key> WEBHOOK_URL=<url> pnpm demo:telegram
 *
 * WEBHOOK_URL is the public HTTPS URL where Telegram will send updates
 * (e.g. https://abc.ngrok.io/webhook).
 */

import "dotenv/config";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { parse } from "yaml";
import { readFileSync } from "node:fs";

import { processEvent } from "@/index";
import { TelegramInputAdopter } from "@/implementation/inputAdopter/telegram";

import { InMemoryFileSystem } from "@/implementation/tool/file/filesystem/inMemory";
import { FileSystemAgentRepository } from "@/implementation/agent/repository";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";

import type { Update } from "@/implementation/inputAdopter/telegram";

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
const config = parse(configContent);

// ── Build dependencies ──────────────────────────────────────────────────────

const fileSystem = new InMemoryFileSystem();
const templateRepository = new FileSystemTemplateRepository(fileSystem);

// Load templates from config
for (const t of config.templates ?? []) {
  await templateRepository.add({
    name: t.name,
    description: t.description,
    ai_provider: t.ai_provider,
    model: t.model,
    systemPrompt: t.systemPrompt,
    allowedTools: t.allowedTools ?? [],
  });
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

  await processEvent(messageEvent, {
    fileSystem,
    openai: { apiKey: process.env.OPENAI_API_KEY! },
    telegram: { botToken: TELEGRAM_BOT_TOKEN },
    webSearch: {
      searxngUrl: process.env.SEARXNG_URL ?? "https://searxng.longfangsong.mywire.org",
    },
  });
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

const app = new Hono();

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
