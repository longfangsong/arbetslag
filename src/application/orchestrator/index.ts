export type {
	Config,
	State as MutableState,
	ToolContext,
	ToolExecutionContext,
} from "./state";

import { nanoid } from "nanoid";
import { Chat } from "@/domain/chat/model";
import { MessageEvent } from "@/domain/event/model";
import { step, stepUntilIdle } from "./step";
import { Config, State } from "./state";

export { step, stepUntilIdle };

export async function onUserMessage(
	config: Config,
	state: State,
	chat: Chat,
	content: string,
	adapter: string,
): Promise<State> {
	const userMessageEvent: MessageEvent = {
		id: nanoid(10),
		chat_id: chat.id,
		adapter,
		event_type: "message",
		payload: {
			content,
		},
	};
	state.eventQueue.push(userMessageEvent);
	return await stepUntilIdle(config, state);
}
