import { Context } from "./model/context";
import { loadTemplates } from "./agents/agentLoader";
import { Agent } from "./model/agent";
import { Session } from "./model/session";
import { Write, Read, Replace, List, Delete } from "./model/tool/fileSystem";
import { Await, ListTemplates, Spawn } from "./model/tool/subagent";
import { OpenAIProvider } from "./model/aiProvider/openai";
import { NodeFsFileSystem as NodeFsFileSystem } from "./model/fileSystem/nodefs";

async function main(): Promise<void> {
  const context = new Context(
    [new OpenAIProvider("openai", { baseURL: "http://127.0.0.1:8033/v1" })],
    [Write, Read, Replace, List, Delete, ListTemplates, Spawn, Await],
    new NodeFsFileSystem("./data"),
    await loadTemplates(
      "/Users/longfangsong/Projects/arbetslag/src/agents/configs",
    ),
  );

  const session = new Session({
    prompt:
      "Create two subagents, one write an odd random number to a file named number1.txt, and the other write an even random number to a file named number2.txt. After they are done, read both files and output their sums.",
  });

  const template = context.getTemplate("generalPurposeAgent");
  const agent = new Agent(context, template!);
  console.log("Created agent with ID:", agent.id);

  try {
    const response = await agent.handleRequest(
      context,
      session,
      "Create two subagents, one write an odd random number to a file named number1.txt, and the other write an even random number to a file named number2.txt. After they are done, read both files and output their sums.",
    );
    console.log("Agent response:", response);
  } catch (error) {
    console.error("Error handling request:", error);
  }
}

main().catch(console.error);
