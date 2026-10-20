import OpenAI from "openai";
import { z } from "zod";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam, ChatCompletionContentPartText, ChatCompletionContentPartImage, ChatCompletionTool } from "openai/resources/chat";
import { CompletionResult, Content, ContentPart, contentText, History } from "../../history";
import { CompletionAPI, CompletionRequest } from "../../abstraction/completion";
import { ToolMetadata } from "../../abstraction/tool";

/** Per-request timeout for LLM API calls (20 minutes). */
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;

/** Map framework content to OpenAI's wire format (text/image parts). */
export function contentToStringOrParts(
    content: Content,
    supportsImages = true,
): string | Array<ChatCompletionContentPartText | ChatCompletionContentPartImage> {
    const parts = supportsImages
        ? content
        : content.filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text");
    if (parts.length === 0) return "";
    return parts.map((part) =>
        part.type === "image"
            ? ({ type: "image_url", image_url: { url: part.url } } as const)
            : ({ type: "text", text: part.text } as const),
    );
}

export class OpenAIProvider extends CompletionAPI {
    private client: OpenAI;
    private model: string;

    constructor(apiKey: string, baseUrl: string, model: string) {
        super();
        this.client = new OpenAI({
            baseURL: baseUrl,
            apiKey,
            timeout: REQUEST_TIMEOUT_MS,
        });
        this.model = model;
    }

    async complete(history: History, allowedTools: Array<ToolMetadata>): Promise<CompletionResult> {
        const buildBody = (): ChatCompletionCreateParamsNonStreaming => {
            const messages: ChatCompletionMessageParam[] = history.entries.map((entry) => {
                if (entry.role === "tool") {
                    return {
                        role: "tool" as const,
                        tool_call_id: entry.toolCallId ?? "",
                        content: entry.content,
                    };
                }
                if (entry.role === "system") {
                    return {
                        role: "system" as const,
                        content: contentText(entry.content),
                    };
                }
                if (entry.role !== "assistant") {
                    return {
                        role: "user" as const,
                        content: contentToStringOrParts(entry.content),
                    };
                }
                return {
                    role: "assistant" as const,
                    content: entry.content,
                    tool_calls: entry.toolCalls?.map((tc) => ({
                        id: tc.id ?? "",
                        type: "function" as const,
                        function: {
                            name: tc.toolName,
                            arguments: JSON.stringify(tc.arguments),
                        },
                    })),
                };
            });

            const tools: ChatCompletionTool[] = allowedTools.map((tool) => {
                const schema = z.toJSONSchema(tool.inputSchema);
                return {
                    type: "function" as const,
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: schema as Record<string, unknown>,
                    },
                };
            });
            const body: ChatCompletionCreateParamsNonStreaming = {
                model: this.model,
                messages,
                tools: tools.length > 0 ? tools : undefined,
            };
            return body;
        };

        let response: ChatCompletion = await this.client.chat.completions.create(buildBody());
        const choice = response.choices[0]!;

        const assistantContent = choice.message.content ?? "";
        const toolCalls = choice.message.tool_calls?.map((tc) => {
            if (tc.type !== "function") return null;
            return {
                id: tc.id,
                toolName: tc.function.name,
                arguments: JSON.parse(tc.function.arguments),
            };
        }).filter((tc): tc is NonNullable<typeof tc> => tc !== null);

        return {
            role: "assistant",
            content: assistantContent,
            toolCalls: toolCalls,
            usage:
                response.usage?.prompt_tokens != null
                    ? { promptTokens: response.usage.prompt_tokens }
                    : undefined,
        };

    }
}