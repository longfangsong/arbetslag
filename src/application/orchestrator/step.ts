import { createAgent } from "@/domain/agent/template/model";
import { State } from "./state";
import { Event, MessageEvent, AgentMessageEvent, ToolCallEvent, ToolResponseEvent } from "@/domain/event/model";
import { nanoid } from "nanoid";
import { UserOutputHandler, ToParentOutputHandler } from "@/domain/outputHandler/model";

export async function step(state: State, event: Event): Promise<State> {
    switch (event.event_type) {
        case 'tool_call': {
            const toolCallEvent = event as ToolCallEvent;
            const agent = await state.agentRepository.getById(toolCallEvent.to_agent_id);
            if (!agent) {
                throw new Error(`Agent with ID ${toolCallEvent.to_agent_id} not found`);
            }
            const tool = await state.toolRepository.getByName(toolCallEvent.payload.tool_name);
            if (!tool) {
                throw new Error(`Tool "${toolCallEvent.payload.tool_name}" not found`);
            }
            const result = await tool.call(state, agent, toolCallEvent.payload.arguments);
            state.eventQueue.push({
                id: nanoid(10),
                to_agent_id: toolCallEvent.to_agent_id,
                event_type: 'tool_response',
                payload: {
                    tool_call_id: toolCallEvent.payload.id,
                    name: toolCallEvent.payload.tool_name,
                    content: result.isOk() ? JSON.stringify(result.value) : String(result.error),
                },
            } as ToolResponseEvent);
            return state;
        }
        case 'message': {
            const msgEvent = event as MessageEvent;
            let chat = await state.chatRepository.getById(msgEvent.chat_id);
            if (!chat) {
                const defaultTemplate = await state.agentTemplateRepository.default();
                const outputHandler = new UserOutputHandler(msgEvent.adapter, msgEvent.chat_id);
                const newAgent = createAgent(defaultTemplate, undefined, outputHandler);
                chat = {
                    id: msgEvent.chat_id,
                    entry_agent_id: newAgent.id,
                };
                await state.agentRepository.add(newAgent);
                state.chatRepository.chats.push(chat);
            }
            const agent = await state.agentRepository.getById(chat.entry_agent_id);
            return await agent!.handleEvent(state, msgEvent);
        }
        case 'agent_message': {
            const agentMsg = event as AgentMessageEvent;
            if (!event.to_agent_id) {
                throw new Error('agent_message event is missing target agent ID');
            }
            const agent = await state.agentRepository.getById(event.to_agent_id);
            if (!agent) {
                throw new Error(`Agent with ID ${event.to_agent_id} not found`);
            }
            agent.history.push({ role: 'user', content: agentMsg.payload.content });
            return state;
        }
        case 'tool_response':
        case 'api_callback': {
            if (!event.to_agent_id) {
                throw new Error(`${event.event_type} event is missing target agent ID`);
            }
            const agent = await state.agentRepository.getById(event.to_agent_id);
            if (!agent) {
                throw new Error(`Agent with ID ${event.to_agent_id} not found`);
            }
            return await agent.handleEvent(state, event);
        }
    }
}

export async function stepUntilIdle(state: State): Promise<State> {
    while (state.eventQueue.length > 0) {
        const event = state.eventQueue.shift()!;
        state = await step(state, event);
    }
    return state;
}