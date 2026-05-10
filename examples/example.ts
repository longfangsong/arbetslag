import { createRuntime } from "../src/model/context";
import { FileAgentRepository } from "../src/model/agentRepository";
import { loadTemplates } from "../src/agents/agentLoader";
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
import readline from "readline";
import dotenv from "dotenv";
import { GetTime } from "../src/model/tool/getTime";
import { CreateCronJob } from "../src/model/tool/cronJob";
import { SendTelegramMessage } from "../src/model/tool/telegram";
import { SendSlackMessage } from "../src/model/tool/slack";
import { SendEmail } from "../src/model/tool/email";

dotenv.config();

// For edge runtimes, pass templates directly instead of a directory path:
// const templates = await loadTemplates([...myTemplates]);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main(): Promise<void> {
  const runtime = createRuntime(
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
      GetTime,
      CreateCronJob,
      SendTelegramMessage,
      SendSlackMessage,
      SendEmail,
    ],
    new NodeFsFileSystem("./data"),
    await loadTemplates(["./examples/configs/generalPurposeAgent.json"]),
    {
      cron_token: process.env.cron_token,
      telegram_bot_token: process.env.telegram_bot_token,
      slack_bot_token: process.env.slack_bot_token,
      email_api_url: process.env.email_api_url,
      email_api_key: process.env.email_api_key,
    },
    new FileAgentRepository(new NodeFsFileSystem("./data")),
  );

  const template = runtime.context.agentTemplates.find((t) => t.name === "taskDispatcher");
  const agent = await runtime.context.agentRepository.create(template!, runtime.context);
  console.log("Created agent with ID:", agent.id);

  const prompt =
    process.argv.slice(2).join(" ") ||
    (await new Promise<string>((resolve) => {
      rl.question("Enter your prompt: ", (answer) => {
        resolve(answer);
      });
    }));

  try {
    const response = await runAgent(runtime.context, agent, prompt);
    console.log("Agent response:", response);
  } catch (error) {
    console.error("Error handling request:", error);
  }

  rl.close();
}

main().catch(console.error);
