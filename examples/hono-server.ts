import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createRuntime } from "../src/model/context";
import { FileAgentRepository } from "../src/model/agentRepository";
import { runAgent } from "../src/model/workLoop";
import {
  Write,
  Read,
  Replace,
  List,
  Delete,
} from "../src/model/tool/fileSystem";
import { ListTemplates, Spawn } from "../src/model/tool/subagent";
import { HttpRequest } from "../src/model/tool/http";
import { OpenAIProvider } from "../src/model/aiProvider/openai";
import { NodeFsFileSystem } from "../src/model/fileSystem/nodefs";
import { GetTime } from "../src/model/tool/getTime";
import { CreateCronJob } from "../src/model/tool/cronJob";
import { SendTelegramMessage } from "../src/model/tool/telegram";
import { SendSlackMessage } from "../src/model/tool/slack";
import { SendEmail } from "../src/model/tool/email";
import { EmitEvent } from "../src/model/tool/emitEvent";
import { SubscribeToEvent } from "../src/model/tool/subscribeToEvent";
import { CancelCronJob } from "../src/model/tool/cronJob";
import { loadTemplates } from "../src/agents/agentLoader";
import dotenv from "dotenv";

dotenv.config();

// ── Shared Infrastructure ────────────────────────────────────────────────────
//
// AgentRepository is created once at boot and shared across all requests.
// This ensures agent state persists across requests.

const fileSystem = new NodeFsFileSystem("./data");
const agentRepository = new FileAgentRepository(fileSystem);

// ── Context Factory ──────────────────────────────────────────────────────────

async function buildRuntime() {
  return createRuntime(
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
      GetTime,
      CreateCronJob,
      SendTelegramMessage,
      SendSlackMessage,
      SendEmail,
      EmitEvent,
      SubscribeToEvent,
      CancelCronJob,
    ],
    fileSystem,
    await loadTemplates(["./examples/configs/generalPurposeAgent.json"]),
    {
      cron_token: process.env.cron_token,
      telegram_bot_token: process.env.telegram_bot_token,
      slack_bot_token: process.env.slack_bot_token,
      email_api_url: process.env.email_api_url,
      email_api_key: process.env.email_api_key,
    },
    agentRepository,
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

  const runtime = await buildRuntime();
  const template = runtime.context.agentTemplates.find((t) => t.name === "generalPurposeAgent");

  if (!template) {
    return c.json({ error: "Template 'generalPurposeAgent' not found" }, 404);
  }

  try {
    const agent = await runtime.context.agentRepository.create(template, runtime.context);
    const response = await runAgent(runtime.context, agent, prompt);
    return c.json({ response });
  } catch (error) {
    console.error("Agent error:", error);
    return c.json(
      { error: "Agent request failed", details: String(error) },
      500,
    );
  }
});

// ── Agent REST Endpoints ─────────────────────────────────────────────────────

/**
 * POST /agents — Create a new agent from a template.
 *
 * Request body:
 * ```json
 * {
 *   "templateName": "generalPurposeAgent",
 *   "prompt": "Initial prompt to start the agent"
 * }
 * ```
 */
app.post("/agents", async (c) => {
  const body = await c.req.json();
  const { templateName, prompt } = body;

  if (!templateName) {
    return c.json({ error: "Missing 'templateName' in request body" }, 400);
  }

  const runtime = await buildRuntime();
  const template = runtime.context.agentTemplates.find((t) => t.name === templateName);

  if (!template) {
    return c.json({ error: `Template '${templateName}' not found` }, 404);
  }

  try {
    const agent = await agentRepository.create(template, runtime.context);

    if (prompt) {
      const response = await runAgent(runtime.context, agent, prompt);
      return c.json({ agentId: agent.id, response });
    }

    return c.json({ agentId: agent.id });
  } catch (error) {
    console.error("Agent creation error:", error);
    return c.json(
      { error: "Agent creation failed", details: String(error) },
      500,
    );
  }
});

/**
 * GET /agents/:id — Get agent status.
 */
app.get("/agents/:id", async (c) => {
  const agentId = c.req.param("id");

  const state = await agentRepository.loadState(agentId);
  if (!state) {
    return c.json({ error: `Agent '${agentId}' not found` }, 404);
  }

  const agentState = JSON.parse(state);
  return c.json({
    agentId: agentState.id,
    model: agentState.model,
    provider: agentState.provider,
    toolNames: agentState.toolNames,
    historyLength: agentState.history?.length ?? 0,
  });
});

/**
 * POST /agents/:id/resume — Resume a paused agent with a new prompt.
 *
 * Request body:
 * ```json
 * {
 *   "prompt": "Follow-up message to the agent"
 * }
 * ```
 */
app.post("/agents/:id/resume", async (c) => {
  const agentId = c.req.param("id");
  const body = await c.req.json();
  const prompt = body.prompt as string;

  if (!prompt) {
    return c.json({ error: "Missing 'prompt' in request body" }, 400);
  }

  const runtime = await buildRuntime();

  try {
    const agent = await agentRepository.load(agentId, runtime.context);
    if (!agent) {
      return c.json({ error: `Agent '${agentId}' not found` }, 404);
    }
    const response = await runAgent(runtime.context, agent, prompt);
    return c.json({ response });
  } catch (error) {
    console.error("Agent resume error:", error);
    return c.json(
      { error: "Agent resume failed", details: String(error) },
      500,
    );
  }
});

/**
 * DELETE /agents/:id — Delete an agent's persisted state.
 */
app.delete("/agents/:id", async (c) => {
  const agentId = c.req.param("id");
  const statePath = `run/${agentId}.json`;

  try {
    await fileSystem.deleteFile(statePath);
    return c.json({ message: `Agent '${agentId}' deleted` });
  } catch {
    return c.json({ error: `Agent '${agentId}' not found` }, 404);
  }
});

/**
 * GET /agents — List all agent IDs.
 */
app.get("/agents", async (c) => {
  const allFiles = await fileSystem.listFiles("run");
  const agentIds = allFiles
    .filter((f: string) => f.endsWith(".json"))
    .map((f: string) => f.replace("run/", "").replace(".json", ""));

  return c.json({ agents: agentIds });
});

// ── Start Server ─────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;

console.log(`🚀 Arbetslag Hono server running on http://localhost:${PORT}`);
console.log("  POST /agents        — Create a new agent");
console.log("  GET  /agents        — List all agents");
console.log("  GET  /agents/:id    — Get agent status");
console.log("  POST /agents/:id/resume — Resume agent with new prompt");
console.log("  DELETE /agents/:id  — Delete agent state");
console.log("  GET  /              — Health check");

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

export { app, buildRuntime, agentRepository };
