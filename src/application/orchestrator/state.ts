import { AIProvider } from "@/domain/aiProvider/model";
import { Event } from "@/domain/event/model";
import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import { FileSystem } from "@/domain/filesystem/model";
import { Repository as AgentTemplateRepository } from "@/domain/agent/template/repository";
import { Repository as ChatRepository } from "@/domain/chat/repository";
import { SerializedAgent } from "@/domain/agent/model";
import { Chat } from "@/domain/chat/model";
import { OutputHandlerRegistry } from "@/domain/outputHandler/model";

export interface StaticConfig {
    aiProviders: Array<AIProvider>;
    agentTemplateRepository: AgentTemplateRepository;
    toolRepository: ToolRepository;
    config: Record<string, any>;
    fileSystem: FileSystem;
    output_handler_registry: OutputHandlerRegistry;
}

interface SerializedState {
    agentRepository: Array<SerializedAgent>;
    chatRepository: Array<Chat>;
    eventQueue: Array<Event>;
    toolState: Record<string, any>;
}

export interface State extends StaticConfig {
    agentRepository: AgentRepository;
    chatRepository: ChatRepository;
    eventQueue: Array<Event>;
    toolState: Record<string, any>;
}

export async function deserialize(
    serialized: SerializedState,
    staticConfig: StaticConfig,
): Promise<State> {
    return {
        agentRepository: await AgentRepository.deserialize(serialized.agentRepository, staticConfig.agentTemplateRepository),
        chatRepository: new ChatRepository(serialized.chatRepository),
        eventQueue: serialized.eventQueue,
        toolState: serialized.toolState,
        ...staticConfig,
    };
}

export async function serialize(state: State): Promise<void> {
    const payload: SerializedState = {
        agentRepository: state.agentRepository.serialize(),
        chatRepository: state.chatRepository.chats,
        eventQueue: state.eventQueue,
        toolState: state.toolState,
    };

    await state.fileSystem.writeFile(`run/state.json`, JSON.stringify(payload));
}
