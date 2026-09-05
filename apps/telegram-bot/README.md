# Telegram Bot

A runnable Telegram bot that consumes the **arbetslag** framework library.

This is a workspace app: it imports everything from the `arbetslag` package
(`packages/arbetslag`) rather than the framework's internal source, so it is a
real consumer of the published API.

## Quick Start

1. Build the library (the bot runs against the built `dist/`):

```bash
pnpm --filter arbetslag run build
```

2. Copy and fill in the environment variables:

```bash
cp .env.example .env
# Edit .env with your tokens
```

3. Start an ngrok tunnel (or expose your server publicly):

```bash
ngrok http 3000
```

4. Run the bot (replace `WEBHOOK_URL` with your ngrok HTTPS URL):

```bash
pnpm --filter telegram-bot run start
# or, build arbetslag first in one shot:
pnpm demo:telegram
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
OPENAI_API_KEY=fake OPENAI_BASE_URL=http://localhost:11434/v1 MODEL_NAME=llama3.2 pnpm --filter telegram-bot run start
```

### Change the system prompt

Edit the template in `arbetslag.yaml` to customize the agent's behavior.

### Add more tools

Pass tools via `customTools` in `processEvent` inside `telegram-bot.ts`.
