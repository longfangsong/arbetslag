import { Context, InMemoryFileSystem } from "./model/context";
import { cloneDeep } from "es-toolkit";
import { generalPurposeAgentTemplate } from "./agents/generalPurpose";
import { Agent } from "./model/agent";
import { OllamaAIProvider } from "./aiProvider/ollama";

const context: Context = {
    fileSystem: new InMemoryFileSystem(),
    aiProviders: new Map(),
    tools: new Map(),
}

context.aiProviders.set("ollama", new OllamaAIProvider("ollama", "gemma4:26b"));
context.tools = new Map(cloneDeep(generalPurposeAgentTemplate.tools).map(tool => [tool.name, tool]));

const agent = new Agent(context, generalPurposeAgentTemplate);

agent.handleRequest("Create two subagents, one write an odd random number to a file named number1.txt, and the other write an even random number to a file named number2.txt. After they are done, read both files and output their sums.").then(response => {
    console.log("Agent response:", response);
    console.log("File system state:", context.fileSystem);
}).catch(error => {
    console.error("Error handling request:", error);
});
