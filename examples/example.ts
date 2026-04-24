import { Context } from "../src/model/context";
import { loadTemplates } from "../src/agents/agentLoader";
import { Agent } from "../src/model/agent";
import { Session } from "../src/model/session";
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
import { GetTime } from "@/model/tool/getTime";
import { CreateCronJob } from "@/model/tool/cronJob";

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
        baseURL: "http://127.0.0.1:8000/v1",
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
    ],
    new NodeFsFileSystem("./data"),
    await loadTemplates("./examples/configs"),
    {
      cron_token: process.env.cron_token,
    },
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
