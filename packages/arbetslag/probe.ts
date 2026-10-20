import type { JsonValue } from "type-fest";
import { Project } from "./src/project";
import { Runtime } from "./src/index";
import { CompletionAPI, type CompletionRequest } from "./src/abstraction/completion";
import { Tool, type ToolCallRequest } from "./src/abstraction/tool";
import type { CompletionResult, History } from "./src/history";
import type { ToolMetadata } from "./src/abstraction/tool";
import { CompletionAgent } from "./src/agent";
import { InputAdapter } from "./src/abstraction/inputAdapter";
import type { Store } from "./src/abstraction/store";
import { z } from "zod";

class MemoryStore implements Store {
	private readonly data = new Map<string, string>();
	async set(key: string, value: string): Promise<void> {
		this.data.set(key, value);
	}
	async get(key: string): Promise<string | undefined> {
		return this.data.get(key);
	}
}

/** 记录它到底收到了什么形状的请求 */
class ProbeCompletion extends CompletionAPI {
	readonly id: string = "completion:probe";
	readonly seen: Array<CompletionRequest> = [];
	async complete(history: History, tools: Array<ToolMetadata>): Promise<CompletionResult> {
		this.seen.push({ history, tools });
		return { role: "assistant", content: "ok" };
	}
}

class ProbeTool extends Tool<{ q: string }, string> {
	readonly id: string = "tool:probe";
	description = "probe";
	inputSchema = z.object({ q: z.string() });
	readonly seen: Array<ToolCallRequest<{ q: string }>> = [];
	async call(input: { q: string }): Promise<string> {
		this.seen.push({ id: "call", input });
		return `got:${input.q}`;
	}
}

class ManualInput extends InputAdapter {
	readonly id: string = "input:probe";
	push(payload: JsonValue): Promise<void> {
		return this.accept(payload);
	}
}

const runtime = new Runtime(new MemoryStore());
const input = new ManualInput();
const completion = new ProbeCompletion();
const tool = new ProbeTool();
runtime.register(input);
runtime.register(completion);
runtime.register(tool);

const project = new Project();
project.register(input);
project.register(completion);
project.register({ id: "completion:agent", historyId: "h1", apiId: "completion:probe", allowedTools: [] } as CompletionAgent);

project.connect(input, tool);
project.connect(tool, completion);

const running = project.start(runtime).catch((error: unknown) => {
	console.log(`project.start() rejected: ${(error as Error).message}`);
});

await input.push({ q: "hello" } as JsonValue);
await new Promise((r) => setTimeout(r, 50));
await project.stop();
await running;

console.log("tool.seen   :", JSON.stringify(tool.seen));
console.log("completion.seen:", JSON.stringify(completion.seen));
