import OpenAI from "openai";
import {
	AIProvider,
	CompletionResult,
	HistoryEntry,
} from "@/domain/aiProvider/model";
import { Tool } from "@/domain/tool/model";
import { z } from "zod";

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;

export class OpenAIProvider implements AIProvider {
	name: string = "openai";
	private client: OpenAI;

	constructor() {
		this.client = new OpenAI({
			baseURL: process.env.OPENAI_BASE_URL,
			apiKey: process.env.OPENAI_API_KEY,
		});
	}

	private toOpenAIMessage(entry: HistoryEntry): OpenAIMessage {
		if (entry.role === "tool") {
			return {
				role: "tool",
				tool_call_id: entry.tool_call_id ?? "",
				content: entry.content,
			};
		}
		return {
			role: entry.role,
			content: entry.content,
		};
	}

	private toOpenAITool(tool: Tool<unknown, unknown, unknown>): OpenAITool {
		const schema = z.toJSONSchema(tool.inputSchema);
		return {
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: schema as Record<string, unknown>,
			},
		};
	}

	async complete(
		model: string,
		history: Array<HistoryEntry>,
		allowedTools: Array<Tool<unknown, unknown, unknown>>,
	): Promise<CompletionResult> {
		const messages: OpenAIMessage[] = history.map((entry) =>
			this.toOpenAIMessage(entry),
		);
		const tools: OpenAITool[] = allowedTools.map((tool) =>
			this.toOpenAITool(tool),
		);

		const response = await this.client.chat.completions.create({
			model,
			messages,
			tools: tools.length > 0 ? tools : undefined,
		});

		const choice = response.choices[0];
		if (!choice) throw new Error("No completion choice returned");

		const assistantContent = choice.message.content ?? "";
		const toolCalls = choice.message.tool_calls?.map((tc) => ({
			id: tc.id,
			tool_name:
				tc.type === "function" ? tc.function.name : (tc.custom?.name ?? ""),
			arguments:
				tc.type === "function"
					? JSON.parse(tc.function.arguments)
					: JSON.parse(tc.custom?.input ?? "{}"),
		}));

		return {
			role: "assistant",
			content: assistantContent,
			tool_calls: toolCalls,
		};
	}
}
