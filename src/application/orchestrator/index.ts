import { nanoid } from "nanoid";
import { Chat } from "@/domain/chat/model";
import { MessageEvent } from "@/domain/event/model";
import { stepUntilIdle } from "./step";
import { State } from "./state";

export async function onUserMessage(state: State, chat: Chat, content: string): Promise<State> {
    const userMessageEvent: MessageEvent = {
        id: nanoid(10),
        chat_id: chat.id,
        adapter: 'generic',
        event_type: 'message',
        payload: {
            content,
        },
    };
    state.eventQueue.push(userMessageEvent);
    return await stepUntilIdle(state);
}
