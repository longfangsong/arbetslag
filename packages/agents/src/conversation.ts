import { z } from "zod";
import { type Transition, defineNode } from "@arbetslag/kernel";
import {
	APPEND_PORT,
	HISTORY_PORT,
	type HistoryMessage,
	USER_PORT,
	historyMessageSchema,
	historySchema,
	text,
} from "./history.ts";

/** conversation 的私有状态：就是整份**对话历史**（ADR-0010）。 */
export const conversationStateSchema = z
	.object({ history: historySchema.default([]) })
	.default({ history: [] });

export type ConversationState = z.infer<typeof conversationStateSchema>;

export const CONVERSATION_NAME = "conversation";

/**
 * conversation（ADR-0010）：history 的**唯一**持有者，别的节点想读就读它的 `history` 端口。
 *
 * - 收到 `user`（`{ text }`）→ 记成一条 user 消息；
 * - 收到 `append`（一条 `HistoryMessage`）→ 原样记为最后一条；
 * - 每次记完都沿 `history` 发一份**整份**快照，谁接谁读（judge、agent）。
 *
 * 它不判断「该不该问模型」：那是消费者的事（`answerable`）。也不压缩、不裁剪。
 */
export const conversation = defineNode<ConversationState, null>({
	name: CONVERSATION_NAME,
	version: 1,
	state: conversationStateSchema,
	config: z.null(),
	ports: () => ({
		[USER_PORT]: z.object({ text: z.string() }),
		[APPEND_PORT]: historyMessageSchema,
		[HISTORY_PORT]: historySchema,
	}),
	step: ({ state, message }) => {
		let recorded: HistoryMessage;
		switch (message.type) {
			case USER_PORT:
				recorded = { role: "user", blocks: [text((message.body as { text: string }).text)] };
				break;
			case APPEND_PORT:
				recorded = message.body as HistoryMessage;
				break;
			default:
				return { state };
		}
		const history = [...state.history, recorded];
		return {
			state: { history },
			sends: [{ port: HISTORY_PORT, body: history }],
		} satisfies Transition<ConversationState>;
	},
});
