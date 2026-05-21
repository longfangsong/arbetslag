import { Config, State } from "@/application/orchestrator/state";
import { InMemoryFileSystem } from "@/infrastructure/filesystem/inMemory";
import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Repository as AgentTemplateRepository } from "@/domain/agent/template/repository";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import { Repository as ChatRepository } from "@/domain/chat/repository";
import { OutputHandlerRegistry } from "@/domain/outputHandler/model";

export function createMockConfig(overrides?: Partial<Config>): Config {
	return {
		aiProviders: [],
		agentTemplateRepository: new AgentTemplateRepository(),
		toolRepository: new ToolRepository(),
		config: {},
		fileSystem: new InMemoryFileSystem(),
		outputHandlerRegistry: new OutputHandlerRegistry(),
		...overrides,
	};
}

export function createMockState(overrides?: Partial<State>): State {
	return {
		agentRepository: new AgentRepository(),
		chatRepository: new ChatRepository(),
		eventQueue: [],
		toolState: {},
		...overrides,
	};
}
