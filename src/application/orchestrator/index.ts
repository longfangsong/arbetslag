import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Event } from "@/domain/event/model";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import { FileSystem } from "@/domain/filesystem/model";
import { Repository as AgentTemplateRepository } from "@/domain/agent/template/repository";

export interface State {
    agent_repository: AgentRepository;
    agent_template_repository: AgentTemplateRepository;
    tool_repository: ToolRepository;
    event_queue: Array<Event>;
    file_system: FileSystem;
    config: Record<string, any>;
    tool_state: Record<string, any>;
}

export function step(state: State, event: Event): State {
    switch (event.event_type) {
        case 'user_message':
            // Handle user message event
            break;
        case 'tool_response':
            // Handle tool response event
            break;
        case 'api_callback':
            // Handle API callback event
            break;
        default:
            console.warn(`Unknown event type: ${event.event_type}`);
    }
    return state;
}

export function stepUntilIdle(state: State): State {
    while (state.event_queue.length > 0) {
        const event = state.event_queue.shift()!;
        state = step(state, event);
    }
    return state;
}
