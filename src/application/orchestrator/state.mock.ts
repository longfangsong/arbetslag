import { State } from "@/application/orchestrator/state";
import { InMemoryFileSystem } from "@/infrastructure/filesystem/inMemory";
import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Repository as AgentTemplateRepository } from "@/domain/agent/template/repository";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import { Repository as ChatRepository } from "@/domain/chat/repository";

export function createMockState(overrides?: Partial<State>): State {
    return {
        aiProviders: [],
        agentRepository: new AgentRepository(),
        agentTemplateRepository: new AgentTemplateRepository(),
        toolRepository: new ToolRepository(),
        chatRepository: new ChatRepository(),
        eventQueue: [],
        file_system: new InMemoryFileSystem(),
        config: {},
        toolState: {},
        ...overrides,
    };
}
