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

/**
 * Immutable configuration and dependencies that don't change during execution.
 */
export interface Config {
	aiProviders: Array<AIProvider>;
	agentTemplateRepository: AgentTemplateRepository;
	toolRepository: ToolRepository;
	config: Record<string, any>;
	fileSystem: FileSystem;
	outputHandlerRegistry: OutputHandlerRegistry;
}

/**
 * Mutable runtime state that changes during agent execution.
 */
export interface State {
	agentRepository: AgentRepository;
	chatRepository: ChatRepository;
	eventQueue: Array<Event>;
	toolState: Record<string, any>;
}

interface SerializedState {
	agentRepository: Array<SerializedAgent>;
	chatRepository: Array<Chat>;
	eventQueue: Array<Event>;
	toolState: Record<string, any>;
}


export async function deserialize(
	serialized: SerializedState,
	config: Config,
): Promise<State> {
	return {
		agentRepository: await AgentRepository.deserialize(
			serialized.agentRepository,
			config.agentTemplateRepository,
		),
		chatRepository: new ChatRepository(serialized.chatRepository),
		eventQueue: serialized.eventQueue,
		toolState: serialized.toolState,
	};
}

export async function serialize(
	config: Config,
	state: State,
): Promise<void> {
	const payload: SerializedState = {
		agentRepository: state.agentRepository.serialize(),
		chatRepository: state.chatRepository.chats,
		eventQueue: state.eventQueue,
		toolState: state.toolState,
	};

	await config.fileSystem.writeFile(`run/state.json`, JSON.stringify(payload));
}

/**
 * Minimal context needed by tools that only read config and write files.
 * Used by: HttpRequest, GetTime, SendTelegramMessage.
 */
export interface ToolContext {
	config: Record<string, any>;
	fileSystem: FileSystem;
}

/**
 * Full context needed by tools that also need to interact with agents/events.
 * Used by: Spawn, ListTemplates.
 */
export interface ToolExecutionContext extends ToolContext {
	agentTemplateRepository: AgentTemplateRepository;
	agentRepository: AgentRepository;
	eventQueue: Array<Event>;
	toolState: Record<string, any>;
}
