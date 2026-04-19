import { Context } from "./model/context";
import { getAgentTemplate, loadTemplates } from "./agents/agentLoader";
import { Agent } from "./model/agent";
import { Session } from "./model/session";
import { FileSystem } from "./model/fileSystem";
import { Write, Read, Replace, List, Delete } from "./model/tool/fileSystem";
import { ListTemplates, Spawn } from "./model/tool/subagent";
import { OpenAIProvider } from "./model/aiProvider/openai";

// Simple in-memory file system for demonstration
class InMemoryFileSystem implements FileSystem {
    private files: Map<string, string> = new Map();

    async readFile(path: string, _offset?: number, _length?: number): Promise<string> {
        const content = this.files.get(path);
        if (content === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        return content;
    }

    async writeFile(path: string, content: string): Promise<void> {
        this.files.set(path, content);
    }

    async editFile(path: string, content: string, _offset: number, _length: number): Promise<void> {
        const existing = this.files.get(path);
        if (existing === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        this.files.set(path, existing.slice(0, _offset) + content + existing.slice(_offset + _length));
    }

    async listFiles(_directory: string): Promise<string[]> {
        return Array.from(this.files.keys());
    }

    async deleteFile(path: string): Promise<void> {
        this.files.delete(path);
    }
}

async function main(): Promise<void> {
    const context = new Context(
        [
            new OpenAIProvider("openai", { baseURL: "http://127.0.0.1:8033/v1" }),
        ],
        [Write, Read, Replace, List, Delete, ListTemplates, Spawn],
        new InMemoryFileSystem(),
        await loadTemplates("/Users/longfangsong/Projects/arbetslag/src/agents/configs")
    );
    

    const session = new Session({ prompt: "Create two subagents, one write an odd random number to a file named number1.txt, and the other write an even random number to a file named number2.txt. After they are done, read both files and output their sums." });

    const template = context.getTemplate("generalPurposeAgent");
    const agent = new Agent(context, template!);
    console.log("Created agent with ID:", agent.id);

    try {
        const response = await agent.handleRequest(context, session, "Create two subagents, one write an odd random number to a file named number1.txt, and the other write an even random number to a file named number2.txt. After they are done, read both files and output their sums.");
        console.log("Agent response:", response);
    } catch (error) {
        console.error("Error handling request:", error);
    }
}

main().catch(console.error);
