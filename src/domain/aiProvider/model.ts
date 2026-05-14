import { State } from "@/application/orchestrator";
import { Agent } from "../agent/model";
import { Tool } from "../tool/model";
import { nanoid } from "nanoid";
import { ToolCallEvent } from "@/domain/event/model";

export interface ToolCall {
    id?: string;
    tool_name: string;
    arguments: Record<string, any>;
}

export interface ToolCallResult {
    role: 'tool';
    tool_call_id?: string;
    name: string;
    content: string;
}

export interface CompletionResult {
    role: 'assistant';
    content: string;
    tool_calls?: Array<ToolCall>;
}

export type HistoryEntry = {
    role: 'system' | 'user';
    content: string;
} | ToolCallResult | CompletionResult;

export interface AIProvider {
    name: string;
    complete(
        model: string,
        history: Array<HistoryEntry>, 
        allowedTools: Array<Tool<unknown, unknown, unknown>>
    ): Promise<CompletionResult>;
}

export async function complete(state: State, agent: Agent): Promise<State> {
    const provider = state.ai_providers.find(p => p.name === agent.template.ai_provider);
    if (!provider) {
        throw new Error(`AI provider ${agent.template.ai_provider} not found`);
    }
    const allowedTools = state.tool_repository.tools.filter(tool => agent.template.allowedTools.includes(tool.name));
    const response = await provider.complete(
        agent.template.model,
        agent.history,
        allowedTools,
    );
    agent.history.push(response);
    if (response.tool_calls) {
        for (const tool_call of response.tool_calls) {
            state.event_queue.push({
                id: tool_call.id || nanoid(10),
                to_agent_id: agent.id,
                event_type: 'tool_call',
                payload: tool_call,
            } as ToolCallEvent);
        }
    }
    return state;
}