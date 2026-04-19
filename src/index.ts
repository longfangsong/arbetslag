import { Context } from "./model/context";
import { loadTemplates } from "./agents/agentLoader";
import { Agent } from "./model/agent";
import { Session } from "./model/session";
import { Write, Read, Replace, List, Delete } from "./model/tool/fileSystem";
import { Await, ListTemplates, Spawn } from "./model/tool/subagent";
import { HttpRequest } from "./model/tool/http";
import { OpenAIProvider } from "./model/aiProvider/openai";
import { NodeFsFileSystem as NodeFsFileSystem } from "./model/fileSystem/nodefs";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main(): Promise<void> {
  const context = new Context(
    [new OpenAIProvider("openai", { baseURL: "http://127.0.0.1:8033/v1" })],
    [Write, Read, Replace, List, Delete, HttpRequest, ListTemplates, Spawn, Await],
    new NodeFsFileSystem("./data"),
    await loadTemplates(
      "/Users/longfangsong/Projects/arbetslag/src/agents/configs",
    ),
  );

  const template = context.getTemplate("generalPurposeAgent");
  const agent = new Agent(context, template!);
  console.log("Created agent with ID:", agent.id);

  const prompt = process.argv.slice(2).join(" ") || await new Promise<string>((resolve) => {
    rl.question("Enter your prompt: ", (answer) => {
      resolve(answer);
    });
  });

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
