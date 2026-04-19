import OpenAI from "openai";
import {
    type ChatCompletionMessageParam,
    type ChatCompletionTool,
    type ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import { Tool } from "../tool";
import { z } from "zod";
import { AIProvider, AssistantMessage, ToolCall } from ".";

export interface OpenAICompatibleProviderOptions {
    apiKey?: string;
    baseURL?: string;
    organization?: string;
    project?: string;
}

export class OpenAIProvider extends AIProvider {
    name: string;
    private client: OpenAI;

    constructor(name: string, options: OpenAICompatibleProviderOptions = {}) {
        super();
        this.name = name;
        this.client = new OpenAI({
            apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? "EMPTY",
            baseURL: options.baseURL ?? process.env.OPENAI_BASE_URL,
            organization: options.organization ?? process.env.OPENAI_ORG_ID,
            project: options.project ?? process.env.OPENAI_PROJECT_ID,
        });
    }

    protected buildToolDefinitions(tools: Array<Tool<any, any>>): ChatCompletionTool[] {
        const toolDefinitions: ChatCompletionTool[] = tools.map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: z.toJSONSchema(tool.inputSchema),
                strict: true,
            },
        }));
        return toolDefinitions;
    }

    protected createInitialMessages(systemPrompt: string, message: string): ChatCompletionMessageParam[] {
        const messages: ChatCompletionMessageParam[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
        ];
        return messages;
    }

    protected async requestNextResponse(
        model: string,
        messages: unknown[],
        toolDefinitions: unknown,
    ): Promise<unknown> {
        return this.client.chat.completions.create({
            model,
            messages: messages as ChatCompletionMessageParam[],
            tools: toolDefinitions as ChatCompletionTool[],
            tool_choice: (toolDefinitions as ChatCompletionTool[]).length > 0 ? "auto" : "none",
        });
    }

    protected parseResponse(response: unknown): AssistantMessage | undefined {
        const msg = (response as { choices?: Array<{ message: { content?: unknown; tool_calls?: unknown[] } }> }).choices?.[0]?.message;
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
        const toolMessage: ChatCompletionToolMessageParam = {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
        };
        return toolMessage;
    }

    protected extractFinalContent(assistantMessage: AssistantMessage): string {
        const content = assistantMessage.content;

        if (typeof content === "string") {
            return content;
        }

        if (Array.isArray(content)) {
            return content
                .map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
                .join("");
        }

        return "";
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
