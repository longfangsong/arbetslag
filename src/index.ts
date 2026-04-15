import { Context } from "./model/context";
import { generalPurposeAgentTemplate } from "./agents/generalPurpose";
import { Agent } from "./model/agent";
import { OllamaAIProvider } from "./aiProvider/ollama";
import { InMemoryFileSystem, OnDiskFileSystem, Session } from "./model/session";

const context = new Context(
    [new OllamaAIProvider("ollama")]
);

const session = new Session(new OnDiskFileSystem("./data"));

const agent = new Agent(context, generalPurposeAgentTemplate);

agent.handleRequest(session, "Create two subagents, one write an odd random number to a file named number1.txt, and the other write an even random number to a file named number2.txt. After they are done, read both files and output their sums.").then(response => {
    console.log("Agent response:", response);
    console.log("File system state:", session.fileSystem);
}).catch(error => {
    console.error("Error handling request:", error);
});
