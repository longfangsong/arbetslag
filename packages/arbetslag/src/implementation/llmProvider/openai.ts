import OpenAI from "openai";
import { Content, ContentPart, contentText, HistoryEntry } from "../../model/history";
import { ChatCompletion, ChatCompletionContentPartImage, ChatCompletionContentPartText, ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from "openai/resources";
import { LLMCompletionDoneEvent, LLMCompletionRequestEvent, LLMProvider } from "../../model/llmProvider";
import { State } from "../../model/state";
import { Event } from "../..";
import z from "zod";
import { zodResponseFormat } from "openai/helpers/zod.js";
import { err } from "neverthrow";
import { ToolCallRequestEvent } from "../../model/tool";


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

export class OpenAIProvider implements LLMProvider {
    id: string = "openai";
    private client: OpenAI;
    /** Flipped off automatically when the backend rejects image_url parts. */
    private supportsImages = true;

    constructor(apiKey: string, baseUrl: string) {
        this.client = new OpenAI({
            baseURL: baseUrl,
            apiKey,
            timeout: REQUEST_TIMEOUT_MS,
        });
    }


    async call(state: State, event: Event): Promise<State> {
        if (event.type !== "llmCompletionRequest") {
            return state;
        }
        const typedEvent = event as LLMCompletionRequestEvent;
        if (typedEvent.llmProviderId !== this.id) {
            return state;
        }
        const history = state.persistent.histories.find((h) => h.id === typedEvent.historyId)!;
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
                    content: contentToStringOrParts(entry.content, this.supportsImages),
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
        const tools = state.runtime.tools.filter(tool => typedEvent.toolIds.includes(tool.id)).map(tool => {
            const schema = z.toJSONSchema(tool.inputSchema);
            return {
                type: "function" as const,
                function: {
                    name: tool.id,
                    description: tool.description,
                    parameters: schema as Record<string, unknown>,
                },
            };
        });
        const body: ChatCompletionCreateParamsNonStreaming = {
            model: this.id,
            messages,
            tools: tools.length > 0 ? tools : undefined,
        };
        if (typedEvent.outputSchema) {
            body["response_format"] = zodResponseFormat(typedEvent.outputSchema, "output");
        }

        let response = (await this.client.chat.completions.create(body)) as ChatCompletion;
		const choice = response.choices[0]!;
		const assistantContent = choice.message.content ?? "";
		const toolCalls = choice.message.tool_calls?.map((tc) => {
			if (tc.type !== "function") return null;
			return {
				id: tc.id,
				tool_name: tc.function.name,
				arguments: JSON.parse(tc.function.arguments),
			};
		}).filter((tc): tc is NonNullable<typeof tc> => tc !== null);
        state.runtime.eventBus.push({
            type: "llmCompletionDone",
            result: {
                role: "assistant",
                content: assistantContent,
                toolCalls,
                usage:
                    response.usage?.prompt_tokens != null
                        ? { promptTokens: response.usage.prompt_tokens }
                        : undefined,
            },
        } as LLMCompletionDoneEvent);
        for (const toolCall of toolCalls ?? []) {
            const tool = state.runtime.tools.find(t => t.id === toolCall.tool_name)!;
            state.runtime.eventBus.push({
                type: "toolCallRequest",
                id: toolCall.id,
                input: tool.inputSchema.parse(toolCall.arguments),
            } as ToolCallRequestEvent<unknown>);
        }
        return state;
    }
}