import type { JsonValue } from "type-fest";
import {
	type History,
	type HistoryMessage,
	type ModelCompleteResult,
	type ToolCallBlock,
	type ToolSpec,
} from "@arbetslag/agents";

/**
 * 这里只写「OpenAI 的聊天补全长什么样」，不碰 SDK：翻译是纯函数，可以单独测。
 * `openai/index.ts` 只负责把这里的形状交给 SDK。
 */
export type OpenAIToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

export type OpenAIMessage =
	| { role: "system" | "user"; content: string }
	| { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
	| { role: "tool"; tool_call_id: string; content: string };

export type OpenAITool = {
	type: "function";
	function: { name: string; description: string; parameters: JsonValue };
};

/** 工具清单原样搬过去：`input` 本来就是 JSON Schema（ADR-0009）。 */
export function toToolDefinitions(tools: ToolSpec[]): OpenAITool[] {
	return tools.map((tool) => ({
		type: "function",
		function: { name: tool.name, description: tool.description, parameters: tool.input },
	}));
}

const asText = (value: JsonValue): string => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * 一条 history 消息可能落成多条 OpenAI 消息：assistant 的调用是一句，
 * 每个工具结果各是一句（API 就是这么要求的）。
 */
export function toChatMessages(history: History): OpenAIMessage[] {
	return history.flatMap((message): OpenAIMessage[] => {
		switch (message.role) {
			case "system":
			case "user":
				return [{ role: message.role, content: textsOf(message) }];

			case "assistant": {
				const calls = message.blocks.filter((block): block is ToolCallBlock => block.type === "tool-call");
				const content = textsOf(message);
				const out: OpenAIMessage = {
					role: "assistant",
					content: content === "" ? null : content,
					...(calls.length === 0
						? {}
						: {
								tool_calls: calls.map((call) => ({
									id: call.callId,
									type: "function" as const,
									function: { name: call.name, arguments: JSON.stringify(call.input) },
								})),
							}),
				};
				return [out];
			}

			case "tool":
				return message.blocks.flatMap((block): OpenAIMessage[] =>
					block.type === "tool-result"
						? [
								{
									role: "tool",
									tool_call_id: block.callId,
									// 失败也回给模型看：它得知道工具没成（ADR-0006）。
									content: block.ok ? asText(block.result) : `error: ${asText(block.result)}`,
								},
							]
						: [],
				);
		}
	});
}

const textsOf = (message: HistoryMessage): string =>
	message.blocks
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");

/**
 * 模型的回答 → history 消息。`arguments` 解不出来就原样留着：
 * 工具节点的 input schema 会拒收，然后把失败喂回模型让它自己改。
 */
export function fromAssistant(content: string | null, toolCalls: OpenAIToolCall[] = []): ModelCompleteResult {
	const blocks: HistoryMessage["blocks"] = [];
	if (content !== null && content !== "") blocks.push({ type: "text", text: content });
	for (const call of toolCalls) {
		blocks.push({
			type: "tool-call",
			callId: call.id,
			name: call.function.name,
			input: parseArguments(call.function.arguments),
		});
	}
	// 空回答不当成功：agent 会把它当失败说出来，而不是悄悄不动（ADR-0008 的可见性）。
	if (blocks.length === 0) return { ok: false, error: "model returned nothing" };
	return { ok: true, message: { role: "assistant", blocks } };
}

function parseArguments(raw: string): JsonValue {
	if (raw.trim() === "") return {};
	try {
		return JSON.parse(raw) as JsonValue;
	} catch {
		return raw;
	}
}
