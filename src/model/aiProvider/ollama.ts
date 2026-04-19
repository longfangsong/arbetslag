import { Ollama, type Message } from "ollama";
import { Tool } from "../tool";
import { Tool as OllamaTool } from "ollama";
import { z } from "zod";
import { AIProvider, AssistantMessage, ToolCall } from ".";

export class OllamaAIProvider extends AIProvider {
    name: string;
    private client: Ollama;

    constructor(name: string, endpoint: string = "http://localhost:11434") {
        super();
        this.name = name;
        this.client = new Ollama({ host: endpoint });
    }

    protected buildToolDefinitions(tools: Array<Tool<any, any>>): unknown {
        const toolDefinitions = tools.map(tool => {            
            return {
                type: "function",
                function: {
                    name: (tool.constructor as typeof Tool).name,
                    description: tool.description,
                    parameters: z.toJSONSchema(tool.inputSchema),
                },
            };
        }) as Array<OllamaTool>;
        return toolDefinitions;
    }

    protected createInitialMessages(systemPrompt: string, message: string): Message[] {
        const messages: Message[] = [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: message}
        ];
        return messages;
    }

    protected async requestNextResponse(
        model: string,
        messages: unknown[],
        toolDefinitions: unknown,
    ): Promise<unknown> {
        return this.client.chat({
            model,
            messages: messages as Message[],
            stream: false,
            tools: toolDefinitions as Array<OllamaTool>,
        });
    }

    protected parseResponse(response: unknown): AssistantMessage | undefined {
        const msg = (response as { message?: { content?: unknown; tool_calls?: unknown[] } }).message;
        if (!msg) return undefined;
        return { content: msg.content as string | unknown[], tool_calls: msg.tool_calls as ToolCall[] };
    }

    protected isFunctionToolCall(toolCall: unknown): boolean {
        return typeof toolCall === "object" && toolCall !== null && "function" in toolCall;
    }

    protected getToolName(toolCall: unknown): string {
        return (toolCall as { function: { name: string } }).function.name;
    }

    protected getToolArguments(toolCall: unknown): unknown {
        return (toolCall as { function: { arguments: unknown } }).function.arguments;
    }

    protected createToolMessage(toolCall: ToolCall, toolResult: unknown): unknown {
        return {
            role: "tool",
            tool_name: toolCall.function.name,
            content: JSON.stringify(toolResult),
        };
    }

    protected extractFinalContent(assistantMessage: AssistantMessage): string {
        return String(assistantMessage.content ?? "");
    }

    protected parseToolArguments<T = unknown>(tool: Tool<any, any>, rawArguments: unknown): T {
        if (rawArguments === undefined || rawArguments === null) {
            return tool.inputSchema.parse({}) as T;
        }
        if (typeof rawArguments === "string") {
            let parsed: unknown;
            try {
                parsed = JSON.parse(rawArguments);
            } catch {
                throw new Error(`Invalid JSON in tool arguments: ${rawArguments}`);
            }
            return tool.inputSchema.parse(parsed) as T;
        }
        return tool.inputSchema.parse(rawArguments) as T;
    }
}
