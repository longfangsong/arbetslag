import { Context } from "../src/model/context";
import { loadTemplates } from "../src/agents/agentLoader";
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
import readline from "readline";
import dotenv from "dotenv";
import { GetTime } from "../src/model/tool/getTime";
import { CreateCronJob } from "../src/model/tool/cronJob";
import { AwaitEvent } from "../src/model/tool/awaitEvent";

dotenv.config();

// For edge runtimes, pass templates directly instead of a directory path:
// const templates = await loadTemplates([...myTemplates]);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main(): Promise<void> {
  const context = new Context(
    [
      new OpenAIProvider("openai", {
        baseURL: "http://127.0.0.1:8033/v1",
        apiKey: process.env.openai_apikey,
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

  const template = context.getTemplate("taskDispatcher");
  const agent = new Agent(context, template!);
  console.log("Created agent with ID:", agent.id);

  const prompt =
    process.argv.slice(2).join(" ") ||
    (await new Promise<string>((resolve) => {
      rl.question("Enter your prompt: ", (answer) => {
        resolve(answer);
      });
    }));

  const session = new Session({ prompt });

  try {
    const response = await agent.handleRequest(context, session, prompt);
    console.log("Agent response:", response);
  } catch (error) {
    console.error("Error handling request:", error);
  }

  rl.close();
}

main().catch(console.error);

// ── Event Handler Demo ───────────────────────────────────────────────────────
//
// In a real deployment, you'd wire `handleEvent` to your webhook endpoint:
//
// ```ts
// import { handleEvent, Context, EventRegistry, NodeFsFileSystem, OpenAIProvider,
//          Write, Read, Replace, List, Delete, HttpRequest, ListTemplates,
//          Spawn, Await, GetTime, CreateCronJob, AwaitEvent } from "arbetslag";
// import { loadTemplates } from "arbetslag/dist/agents/agentLoader";
//
// function buildContext(): Context {
//   return new Context(
//     [new OpenAIProvider("openai", { ... })],
//     [Write, Read, Replace, List, Delete, HttpRequest, ListTemplates, Spawn,
//      Await, GetTime, CreateCronJob, AwaitEvent],
//     new NodeFsFileSystem("./data"),
//     await loadTemplates(["./configs/taskDispatcher.json"]),
//     { cron_token: process.env.CRON_TOKEN },
//     new EventRegistry("data/events.json", new NodeFsFileSystem("./data")),
//   );
// }
//
// // Hono example:
// import { Hono } from "hono";
// const app = new Hono();
// app.post("/webhook", async (c) => {
//   const payload = await c.req.json();
//   const context = buildContext();
//   const result = await handleEvent(context, payload);
//   return c.text(result);
// });
// ```
//
// When the agent calls `awaitEvent({ eventId: "cron-xxx" })`, it pauses and
// returns. The external system (cron-job.org) POSTs to your webhook with the
// payload containing `eventId`. `handleEvent` resolves the event, loads the
// agent's saved state from disk, and resumes the loop with the event data.
