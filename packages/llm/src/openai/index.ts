import type { JsonValue } from "type-fest";
import type { ModelCompleteResult } from "@arbetslag/agents";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { ModelCall } from "../index.ts";
import { fromAssistant, toChatMessages, toToolDefinitions } from "./translate.ts";

export type OpenAIModelOptions = {
	/** 不填就用 agent config 里的 `model`，所以换型号只改图、不改部署。 */
	model?: string;
	apiKey?: string;
	baseURL?: string;
	/** 每次请求都带上的旋钮，会被 `input.params` 盖掉（ADR-0009：agents 不解释它）。 */
	params?: Record<string, JsonValue>;
	/** 注入现成客户端：测试、自建网关、代理。 */
	client?: OpenAI;
};

/**
 * `model.complete` 的 OpenAI **Performer**：把厂商无关的 history 翻成聊天补全请求，
 * 再把回答翻回来。旋转钮（`input.params`）原样透传，这里不做白名单。
 */
export function createOpenAIModel(options: OpenAIModelOptions = {}): ModelCall {
	let client = options.client;
	const openai = (): OpenAI => {
		client ??= new OpenAI({
			...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
			...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
		});
		return client;
	};

	return async ({ input }) => {
		const tools = toToolDefinitions(input.tools);
		// 旋钮原样透传（ADR-0009）；`model`/`messages`/`tools` 由我们给，别被盖掉。
		const params = { ...options.params, ...(input.params as Record<string, JsonValue> | undefined) };
		const request = {
			...params,
			model: options.model ?? input.model,
			messages: toChatMessages(input.messages),
			...(tools.length === 0 ? {} : { tools }),
		} as unknown as ChatCompletionCreateParamsNonStreaming;
		const completion = await openai().chat.completions.create(request);

		const choice = completion.choices[0];
		if (choice === undefined) return { ok: false, error: "no choices in the completion" };
		if (choice.message.refusal != null) return { ok: false, error: choice.message.refusal } satisfies ModelCompleteResult;

		const calls = (choice.message.tool_calls ?? []).flatMap((call) =>
			// 只要函数调用；SDK 里还有 custom tool 之类的变体，这一版不认。
			call.type === "function"
				? [{ id: call.id, type: "function" as const, function: { name: call.function.name, arguments: call.function.arguments } }]
				: [],
		);
		return fromAssistant(choice.message.content ?? null, calls);
	};
}

export { fromAssistant, toChatMessages, toToolDefinitions } from "./translate.ts";
export type { OpenAIMessage, OpenAITool, OpenAIToolCall } from "./translate.ts";
