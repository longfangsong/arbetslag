import { nanoid } from "nanoid";
import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import { FileSystem } from "@/domain/filesystem/model";
import { Repository as AgentTemplateRepository } from "@/domain/agent/template/repository";
import { Repository as ChatRepository } from "@/domain/chat/repository";
import { AIProvider } from "@/domain/aiProvider/model";
import { Chat } from "@/domain/chat/model";
import { Event, MessageEvent } from "@/domain/event/model";
import { stepUntilIdle } from "./step";

export interface State {
    ai_providers: Array<AIProvider>;
    agent_repository: AgentRepository;
    agent_template_repository: AgentTemplateRepository;
    chat_repository: ChatRepository;
    tool_repository: ToolRepository;
    event_queue: Array<Event>;
    file_system: FileSystem;
    config: Record<string, any>;
    tool_state: Record<string, any>;
}

export async function onUserMessage(state: State, chat: Chat, content: string): Promise<State> {
    const userMessageEvent: MessageEvent = {
        id: nanoid(10),
        chat_id: chat.id,
        event_type: 'message',
        payload: {
            content,
        },
    };
    state.event_queue.push(userMessageEvent);
    return await stepUntilIdle(state);
}
