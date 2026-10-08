import { EventBase } from "./event";
import { CompletionResult, History, ToolCall } from "./history";

export interface CompletionConfig {
    model?: string;
}

interface APICompletionResult {
    history: History,
    toolCalls?: Array<ToolCall>;
}

export interface CompletionAPI {
    id: string;
    completion(
        history: History,
        tools: Array<{ name: string, description: string }>,
        config: CompletionConfig
    ): Promise<APICompletionResult>;
}

export type CompletionRequest = EventBase & { history: History, tools: Array<{ name: string, description: string }> } & CompletionConfig;
export type CompletionResponse = EventBase & CompletionResult;
