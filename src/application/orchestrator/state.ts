import { State } from ".";
import { Event } from "@/domain/event/model";

interface SerializableState {
    event_queue: Event[];
    config: Record<string, any>;
    tool_state: Record<string, any>;
    saved_at: string;
}

/**
 * Extract serializable state from the orchestrator and write to a file.
 *
 * Repositories, AI providers, and the file system itself are infrastructure
 * objects that are re-injected at runtime — only the data they manage is saved.
 */
export async function saveStateToDisk(state: State, path: string): Promise<void> {
    const payload: SerializableState = {
        event_queue: state.event_queue,
        config: state.config,
        tool_state: state.tool_state,
        saved_at: new Date().toISOString(),
    };

    await state.file_system.writeFile(path, JSON.stringify(payload, null, 2));
}
