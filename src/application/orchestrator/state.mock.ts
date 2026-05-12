import { State } from "@/application/orchestrator";
import { InMemoryFileSystem } from "@/infrastructure/filesystem/inMemory";
import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Repository as AgentTemplateRepository } from "@/domain/agent/template/repository";
import { Repository as ToolRepository } from "@/domain/tool/repository";

export function createMockState(overrides?: Partial<State>): State {
    return {
        agent_repository: new AgentRepository(),
        agent_template_repository: new AgentTemplateRepository(),
        tool_repository: new ToolRepository(),
        event_queue: [],
        file_system: new InMemoryFileSystem(),
        config: {},
        tool_state: {},
        ...overrides,
    };
}
