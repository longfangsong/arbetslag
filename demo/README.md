# Telegram Bot Demo

A runnable Telegram bot powered by the arbetslag agent framework — **webhook mode**.

The demo imports from the `arbetslag` npm package — all infrastructure classes are exported from the package for consumer use.

## Quick Start

1. Copy and fill in the environment variables:

```bash
cp ../.env.example .env
# Edit .env with your tokens
```

2. Start an ngrok tunnel (or expose your server publicly):

```bash
ngrok http 3000
```

3. Run the bot (replace `WEBHOOK_URL` with your ngrok HTTPS URL):

```bash
TELEGRAM_BOT_TOKEN=<token> OPENAI_API_KEY=<key> WEBHOOK_URL=https://abc.ngrok.io/webhook npx tsx demo/telegram-bot.ts
```

## Environment Variables

| Variable             | Required | Description                                                                  |
| -------------------- | -------- | ---------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | ✅       | Bot token from @BotFather                                                    |
| `OPENAI_API_KEY`     | ✅       | OpenAI API key (or any OpenAI-compatible provider)                           |
| `WEBHOOK_URL`        | ✅       | Public HTTPS URL for Telegram webhooks (e.g. `https://abc.ngrok.io/webhook`) |
| `OPENAI_BASE_URL`    | ❌       | OpenAI-compatible base URL (e.g. `http://localhost:11434/v1` for Ollama)     |
| `MODEL_NAME`         | ❌       | Model name (default: `gpt-4o`)                                               |
| `PORT`               | ❌       | HTTP server port (default: `3000`)                                           |

## Features

- **Webhook** — Telegram POSTs updates to the bot; no polling loop
- **Per-chat conversations** — each Telegram chat gets its own agent
- **Tool support** — agents can use `getTime`, `httpRequest`, and `sendTelegramMessage`
- **Sub-agent delegation** — agents can spawn child agents via `spawn` and `list_templates`
- **Graceful shutdown** — webhook is deleted and state is serialized on Ctrl+C

## Customization

### Use Ollama (local LLM)

```bash
OPENAI_API_KEY=fake OPENAI_BASE_URL=http://localhost:11434/v1 MODEL_NAME=llama3.2 WEBHOOK_URL=https://abc.ngrok.io/webhook npx tsx demo/telegram-bot.ts
```

### Change the system prompt

Edit the template in `demo/telegram-bot.ts` to customize the agent's behavior.

### Add more tools

Register additional tools in the `toolRepository.tools` array in `demo/telegram-bot.ts`.
