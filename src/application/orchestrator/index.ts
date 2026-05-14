import { nanoid } from "nanoid";
import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Event, MessageEvent, ToolCallEvent, ToolResponseEvent } from "@/domain/event/model";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import { FileSystem } from "@/domain/filesystem/model";
import { Repository as AgentTemplateRepository } from "@/domain/agent/template/repository";
import { AIProvider } from "@/domain/aiProvider/model";

export interface State {
    ai_providers: Array<AIProvider>;
    agent_repository: AgentRepository;
    agent_template_repository: AgentTemplateRepository;
    tool_repository: ToolRepository;
    event_queue: Array<Event>;
    file_system: FileSystem;
    config: Record<string, any>;
    tool_state: Record<string, any>;
}

export async function step(state: State, event: Event): Promise<State> {
    switch (event.event_type) {
        case 'tool_call': {
            const toolCallEvent = event as ToolCallEvent;
            const agent = await state.agent_repository.getById(toolCallEvent.to_agent_id);
            if (!agent) {
                throw new Error(`Agent with ID ${toolCallEvent.to_agent_id} not found`);
            }
            const tool = await state.tool_repository.getByName(toolCallEvent.payload.tool_name);
            if (!tool) {
                throw new Error(`Tool "${toolCallEvent.payload.tool_name}" not found`);
            }
            const result = await tool.call(state, agent, toolCallEvent.payload.arguments);
            state.event_queue.push({
                id: nanoid(10),
                to_agent_id: toolCallEvent.to_agent_id,
                event_type: 'tool_response',
                payload: {
                    tool_call_id: toolCallEvent.payload.id,
                    name: toolCallEvent.payload.tool_name,
                    content: result.isOk() ? JSON.stringify(result.value) : String(result.error),
                },
            } as ToolResponseEvent);
            break;
        }
        case 'message':
        case 'tool_response':
        case 'api_callback': {
            if (!event.to_agent_id) {
                throw new Error(`${event.event_type} event is missing target agent ID`);
            }
            const agent = await state.agent_repository.getById(event.to_agent_id);
            if (!agent) {
                throw new Error(`Agent with ID ${event.to_agent_id} not found`);
            }
            return await agent.handleEvent(state, event);
        }
    }
    return state;
}

export async function stepUntilIdle(state: State): Promise<State> {
    while (state.event_queue.length > 0) {
        const event = state.event_queue.shift()!;
        state = await step(state, event);
    }
    return state;
}
