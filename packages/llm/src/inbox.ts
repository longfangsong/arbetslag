import { z } from "zod";
import { type Transition, defineNode } from "@arbetslag/kernel";
import { HISTORY_PORT, type History, USER_PORT, toolCallsOf } from "./history.ts";

const userBodySchema = z.object({ text: z.string() });

/** inbox 的私有状态：有没有一轮正在答，以及排着队的话。 */
export const inboxStateSchema = z
	.object({
		busy: z.boolean().default(false),
		queue: z.array(userBodySchema).default([]),
	})
	.default({ busy: false, queue: [] });

export type InboxState = z.infer<typeof inboxStateSchema>;

export const INBOX_NAME = "inbox";

/** 一轮答完了：最后一条是 assistant 说的，而且没再叫工具。 */
const turnDone = (history: History): boolean => {
	const last = history.at(-1);
	return last !== undefined && last.role === "assistant" && toolCallsOf(last).length === 0;
};

/**
 * inbox：放在 conversation 前面，让 LLM 节点**一句一句**地答。
 *
 * - 收到 `user`：没在答就转给 conversation，否则排队；
 * - 收到 `history`（conversation 的快照）：一轮答完了，就放下一句进去。
 *
 * 不放它时，LLM 节点思考期间进来的话会被一次回完（见 `llm`）。
 * 接法：`来源 → inbox (user)`、`inbox → conversation (user)`、`conversation → inbox (history)`。
 */
export const inbox = defineNode<InboxState, null>({
	name: INBOX_NAME,
	version: 1,
	state: inboxStateSchema,
	config: z.null(),
	ports: () => ({ [USER_PORT]: userBodySchema }),
	step: ({ state, message }): Transition<InboxState> => {
		switch (message.type) {
			case USER_PORT: {
				const body = userBodySchema.parse(message.body);
				if (state.busy) return { state: { ...state, queue: [...state.queue, body] } };
				return { state: { ...state, busy: true }, sends: [{ port: USER_PORT, body }] };
			}
			case HISTORY_PORT: {
				if (!state.busy || !turnDone(message.body as History)) return { state };
				const [next, ...rest] = state.queue;
				if (next === undefined) return { state: { busy: false, queue: [] } };
				return { state: { busy: true, queue: rest }, sends: [{ port: USER_PORT, body: next }] };
			}
			default:
				return { state };
		}
	},
});
