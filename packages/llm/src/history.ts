import type { JsonValue } from "type-fest";
import { z } from "zod";

const jsonSchema: z.ZodType<JsonValue> = z.json();

/** 文本块：用户说的、模型说的、工具回的。 */
export const textBlockSchema = z.object({ type: z.literal("text"), text: z.string() });

/** 工具调用块：模型要求调用某个工具。`callId` 由模型给，回结果时用它配对。 */
export const toolCallBlockSchema = z.object({
	type: z.literal("tool-call"),
	callId: z.string().min(1),
	name: z.string().min(1),
	input: jsonSchema,
});

/** 工具结果块：工具跑完之后回到 history 里。失败也是一种结果（ADR-0006）。 */
export const toolResultBlockSchema = z.object({
	type: z.literal("tool-result"),
	callId: z.string().min(1),
	name: z.string().min(1),
	ok: z.boolean().default(true),
	result: jsonSchema,
});

export const historyBlockSchema = z.discriminatedUnion("type", [
	textBlockSchema,
	toolCallBlockSchema,
	toolResultBlockSchema,
]);

/**
 * history 里的一条消息：厂商无关（ADR-0009）。
 * 换成某个厂商的 API 是 **Performer** 的事，不是这里的事。
 */
export const historyMessageSchema = z.object({
	role: z.enum(["system", "user", "assistant", "tool"]),
	blocks: z.array(historyBlockSchema),
});

export const historySchema = z.array(historyMessageSchema);

export type TextBlock = z.infer<typeof textBlockSchema>;
export type ToolCallBlock = z.infer<typeof toolCallBlockSchema>;
export type ToolResultBlock = z.infer<typeof toolResultBlockSchema>;
export type HistoryBlock = z.infer<typeof historyBlockSchema>;
export type HistoryMessage = z.infer<typeof historyMessageSchema>;
export type History = z.infer<typeof historySchema>;

/**
 * history 在端口上的三个名字（端口名就是消息类别，ADR-0005）。
 *
 * - `user`：外面有人说了一句话（触发器与入口节点用它，body 是 `{ text }`）；
 * - `append`：要把一条消息记进 history（body 是一条 `HistoryMessage`）；
 * - `history`：history 此刻的样子（body 是整份 `History`）。
 *
 * `user` 与 `append` 进 conversation，`history` 出 conversation 进消费者（ADR-0010）。
 */
export const USER_PORT = "user";
export const APPEND_PORT = "append";
export const HISTORY_PORT = "history";

export const text = (content: string): TextBlock => ({ type: "text", text: content });

export const textMessage = (role: "system" | "user" | "assistant" | "tool", content: string): HistoryMessage => ({
	role,
	blocks: [text(content)],
});

export const toolResult = (
	block: Pick<ToolResultBlock, "callId" | "name" | "result"> & { ok?: boolean },
): ToolResultBlock => ({
	type: "tool-result",
	callId: block.callId,
	name: block.name,
	ok: block.ok ?? true,
	result: block.result,
});

/** 一条消息里的全部文本，拼起来（没有文本就是空串）。 */
export const textOf = (message: HistoryMessage): string =>
	message.blocks
		.filter((block): block is TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("");

export const toolCallsOf = (message: HistoryMessage): ToolCallBlock[] =>
	message.blocks.filter((block): block is ToolCallBlock => block.type === "tool-call");

/**
 * 「有没有话要回」：最后一条是 user 说的、还是 tool 回的，都要问模型；
 * 最后一条是 assistant 说的就不必再问（否则自己写完的回复会把自己叫醒，ADR-0010）。
 */
export const answerable = (history: History): boolean => {
	const last = history.at(-1);
	return last !== undefined && (last.role === "user" || last.role === "tool");
};

/**
 * 「模型上次之后，有没有新的话要回」：从第 `seen` 条起（模型上次看到的长度）有 user 或 tool 消息就要问。
 * 模型思考期间进来的话排在它的回答**之前**，只看最后一条会把它们漏掉。
 * 不知道 `seen` 时退回 `answerable`。
 */
export const unanswered = (history: History, seen: number | undefined): boolean => {
	if (seen === undefined) return answerable(history);
	return history.slice(seen).some((message) => message.role === "user" || message.role === "tool");
};

/**
 * 交给模型之前理顺工具调用：厂商要求一条带工具调用的 assistant 消息后面**紧跟**它的全部结果。
 * 等工具期间进来的 user / system 消息挪到这批结果之后；history 本身不动（它记的是真实先后）。
 */
export function forModel(history: History): History {
	const out: HistoryMessage[] = [];
	const deferred: HistoryMessage[] = [];
	const open = new Set<string>();
	for (const message of history) {
		if (message.role === "tool") {
			out.push(message);
			for (const block of message.blocks) if (block.type === "tool-result") open.delete(block.callId);
		} else if (open.size > 0 && message.role !== "assistant") {
			deferred.push(message);
			continue;
		} else {
			out.push(...deferred.splice(0));
			out.push(message);
			if (message.role === "assistant") for (const call of toolCallsOf(message)) open.add(call.callId);
		}
		if (open.size === 0) out.push(...deferred.splice(0));
	}
	out.push(...deferred);
	return out;
}
