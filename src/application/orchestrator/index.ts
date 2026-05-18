export type { State } from "./state";

import { nanoid } from "nanoid";
import { Chat } from "@/domain/chat/model";
import { MessageEvent } from "@/domain/event/model";
import { step, stepUntilIdle } from "./step";
import { State } from "./state";

export { step, stepUntilIdle };

export async function onUserMessage(state: State, chat: Chat, content: string, adapter: string = 'generic'): Promise<State> {
    const userMessageEvent: MessageEvent = {
        id: nanoid(10),
        chat_id: chat.id,
        adapter,
        event_type: 'message',
        payload: {
            content,
        },
    };
    state.eventQueue.push(userMessageEvent);
    return await stepUntilIdle(state);
}
