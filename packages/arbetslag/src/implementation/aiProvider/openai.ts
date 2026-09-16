import OpenAI from "openai";
import util from "node:util";
import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { AIProvider } from "@/application/aiProvider/model";
import { HistoryEntry, CompletionResult, ContentPart, contentText } from "@/application/agent/history";
import { Tool } from "@/application/tool/model";
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam, ChatCompletionContentPartText, ChatCompletionContentPartImage, ChatCompletionTool } from "openai/resources/chat";
import { zodResponseFormat } from "openai/helpers/zod.js";

/** Per-request timeout for LLM API calls (20 minutes). */
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;

/** Map framework content to OpenAI's wire format (string or text/image parts). */
export function contentToStringOrParts(
	content: string | Array<ContentPart>,
	supportsImages = true,
): string | Array<ChatCompletionContentPartText | ChatCompletionContentPartImage> {
	if (typeof content === "string") return content;
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

export class OpenAIProvider implements AIProvider {
	name: string = "openai";
	private client: OpenAI;
	/** Flipped off automatically when the backend rejects image_url parts. */
	private supportsImages = true;

	constructor(apiKey: string, baseUrl?: string) {
		this.client = new OpenAI({
			baseURL: baseUrl ?? process.env.OPENAI_BASE_URL,
			apiKey,
			timeout: REQUEST_TIMEOUT_MS,
		});
	}

	async complete(
		model: string,
		history: Array<HistoryEntry>,
		allowedTools: Array<Tool<unknown, unknown, unknown>>,
		outputSchema?: z.ZodType,
	): Promise<Result<CompletionResult, string>> {
		const buildBody = (): ChatCompletionCreateParamsNonStreaming => {
			const messages: ChatCompletionMessageParam[] = history.map((entry) => {
				if (entry.role === "tool") {
					return {
						role: "tool" as const,
						tool_call_id: entry.tool_call_id ?? "",
						content: entry.content,
					};
				}
				if (entry.role === "assistant" && "tool_calls" in entry && entry.tool_calls) {
					return {
						role: "assistant" as const,
						content: entry.content,
						tool_calls: entry.tool_calls.map((tc) => ({
							id: tc.id ?? "",
							type: "function" as const,
							function: {
								name: tc.tool_name,
								arguments: JSON.stringify(tc.arguments),
							},
						})),
					};
				}
				if (entry.role === "system") {
					return {
						role: "system" as const,
						content: contentText(entry.content),
					};
				}
				return {
					role: "user" as const,
					content: contentToStringOrParts(entry.content, this.supportsImages),
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
				model,
				messages,
				tools: tools.length > 0 ? tools : undefined,
			};
			if (outputSchema) {
				body["response_format"] = zodResponseFormat(outputSchema, "output");
			}
			return body;
		};

		let response;
		try {
			response = await this.client.chat.completions.create(buildBody());
		} catch (error) {
			if (
				this.supportsImages &&
				error instanceof Error &&
				/at most 0 image|image input is not supported/i.test(error.message)
			) {
				// Backend rejects image_url parts: mark it and retry without them.
				this.supportsImages = false;
				response = await this.client.chat.completions.create(buildBody());
			} else {
				throw error;
			}
		}
		const choice = response.choices[0];

		if (!choice) return err("No completion choice returned");

		const assistantContent = choice.message.content ?? "";
		const toolCalls = choice.message.tool_calls?.map((tc) => {
			if (tc.type !== "function") return null;
			return {
				id: tc.id,
				tool_name: tc.function.name,
				arguments: JSON.parse(tc.function.arguments),
			};
		}).filter((tc): tc is NonNullable<typeof tc> => tc !== null);

		return ok({
			role: "assistant",
			content: assistantContent,
			tool_calls: toolCalls,
			usage:
				response.usage?.prompt_tokens != null
					? { prompt_tokens: response.usage.prompt_tokens }
					: undefined,
		});
	}
}
