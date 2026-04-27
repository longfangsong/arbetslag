import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { Context } from "../src/model/context";
import { Agent } from "../src/model/agent";
import { Session } from "../src/model/session";
import { EventRegistry } from "../src/model/eventRegistry";
import {
  Write,
  Read,
  Replace,
  List,
  Delete,
} from "../src/model/tool/fileSystem";
import { Await, ListTemplates, Spawn } from "../src/model/tool/subagent";
import { HttpRequest } from "../src/model/tool/http";
import { OpenAIProvider } from "../src/model/aiProvider/openai";
import { NodeFsFileSystem } from "../src/model/fileSystem/nodefs";
import { GetTime } from "../src/model/tool/getTime";
import { CreateCronJob } from "../src/model/tool/cronJob";
import { AwaitEvent } from "../src/model/tool/awaitEvent";
import { handleEvent } from "../src/model/eventHandler";
import { loadTemplates } from "../src/agents/agentLoader";
import dotenv from "dotenv";

dotenv.config();

// ── Context Factory ──────────────────────────────────────────────────────────
//
// Creates a fresh Context per request. This is important because:
// - Each request gets its own AI provider instance
// - Tool instances are constructed per-request
// - Sessions and state are isolated per request

async function buildContext(): Promise<Context> {
  return new Context(
    [
      new OpenAIProvider("openai", {
        baseURL: "http://127.0.0.1:8033/v1",
        apiKey: process.env.OPENAI_API_KEY,
      }),
    ],
    [
      Write,
      Read,
      Replace,
      List,
      Delete,
      HttpRequest,
      ListTemplates,
      Spawn,
      Await,
      GetTime,
      CreateCronJob,
      AwaitEvent,
    ],
    new NodeFsFileSystem("./data"),
    await loadTemplates(["./examples/configs/generalPurposeAgent.json"]),
    {
      cron_token: process.env.cron_token,
    },
    new EventRegistry("data/events.json", new NodeFsFileSystem("./data")),
  );
}

// ── Hono App ─────────────────────────────────────────────────────────────────

const app = new Hono();

/**
 * POST /chat — Start an agent conversation.
 *
 * Request body:
 * ```json
 * {
 *   "prompt": "Write a summary of the files in ./data"
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "sessionId": "abc123",
 *   "agentId": "xyz789",
 *   "response": "Here's the summary..."
 * }
 * ```
 */
app.post("/chat", async (c) => {
  const body = await c.req.json();
  const prompt = body.prompt as string;

  if (!prompt) {
    return c.json({ error: "Missing 'prompt' in request body" }, 400);
  }

  const context = await buildContext();
  const template = context.getTemplate("generalPurposeAgent");

  if (!template) {
    return c.json({ error: "Template 'generalPurposeAgent' not found" }, 404);
  }

  const agent = new Agent(context, template);
  const session = new Session({ prompt });

  try {
    const response = await agent.handleRequest(context, session, prompt);
    return c.json({
      sessionId: session.id,
      agentId: agent.id,
      response,
    });
  } catch (error) {
    console.error("Agent error:", error);
    return c.json(
      { error: "Agent request failed", details: String(error) },
      500,
    );
  }
});

/**
 * POST /webhook — Event handler for resolving paused agents.
 *
 * Used when an agent calls `awaitEvent`. External systems (cron jobs, webhooks,
 * etc.) POST to this endpoint with the event payload.
 *
 * Request body:
 * ```json
 * {
 *   "eventId": "evt_abc123",
 *   "data": { "status": "completed", "result": "..." }
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "result": "Agent resumed with event data..."
 * }
 * ```
 */
app.post("/webhook", async (c) => {
  const payload = await c.req.json();

  const context = await buildContext();

  try {
    const result = await handleEvent(context, payload);
    return c.json({ result });
  } catch (error) {
    console.error("Webhook error:", error);
    return c.json(
      { error: "Event handling failed", details: String(error) },
      500,
    );
  }
});

/**
 * GET / — Health check
 */
app.get("/", (c) => c.json({ status: "ok", service: "arbetslag-agent" }));

// ── Start Server ─────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;

console.log(`🚀 Arbetslag Hono server running on http://localhost:${PORT}`);
console.log("  POST /chat   — Start a new agent conversation");
console.log("  POST /webhook — Resolve paused agents (awaitEvent)");
console.log("  GET  /       — Health check");

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

export { app, buildContext };
