import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Event } from "@/domain/event/model";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import { FileSystem } from "@/domain/filesystem/model";

export interface State {
    agent_repository: AgentRepository;
    tool_repository: ToolRepository;
    event_queue: Array<Event>;
    file_system: FileSystem;
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
