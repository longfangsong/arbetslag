import OpenAI from "openai";
import { z } from "zod";
import { AIProvider } from "@/application/aiProvider/model";
import { HistoryEntry, CompletionResult } from "@/application/aiProvider/history";
import { Tool } from "@/application/tool/model";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat";

export class OpenAIProvider implements AIProvider {
	name: string = "openai";
	private client: OpenAI;

	constructor(apiKey: string, baseUrl?: string) {
		this.client = new OpenAI({
			baseURL: baseUrl ?? process.env.OPENAI_BASE_URL,
			apiKey,
		});
	}

	async complete(
		model: string,
		history: Array<HistoryEntry>,
		allowedTools: Array<Tool<unknown, unknown, unknown>>,
	): Promise<CompletionResult> {
		console.log(`[OpenAIProvider] model=${model}, messages=${history.length}, tools=${allowedTools.length}`);
		console.log(`[OpenAIProvider] baseURL=${this.client.baseURL}, apiKey=${this.client.apiKey ? this.client.apiKey.slice(0, 8) + '...' : 'unset'}`);
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
			return { role: entry.role, content: entry.content };
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

		console.log(`[OpenAIProvider] sending request...`);
		const response = await this.client.chat.completions.create({
			model,
			messages,
			tools: tools.length > 0 ? tools : undefined,
		});
		console.log(`[OpenAIProvider] response received, choices=${response.choices.length}`);

		const choice = response.choices[0];
		if (!choice) throw new Error("No completion choice returned");

		const assistantContent = choice.message.content ?? "";
		const toolCalls = choice.message.tool_calls?.map((tc) => {
			if (tc.type !== "function") return null;
			return {
				id: tc.id,
				tool_name: tc.function.name,
				arguments: JSON.parse(tc.function.arguments),
			};
		}).filter((tc): tc is NonNullable<typeof tc> => tc !== null);

		return {
			role: "assistant",
			content: assistantContent,
			tool_calls: toolCalls,
		};
	}
}
