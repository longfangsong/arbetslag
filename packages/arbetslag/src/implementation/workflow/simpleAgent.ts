import { CompletionRequest } from "../../domain/completion";
import { EventBase } from "../../domain/event";
import { hasToolCalls, History } from "../../domain/history";
import { Workflow, WorkflowReducedResult } from "../../domain/workflow";
import { nanoid } from "../../utils";

export type SimpleAgentConfig = {
    model: string,
    tools: Array<{ name: string, description: string}>
}

export type SimpleAgentState = {
    history: History,
    readonly config: SimpleAgentConfig,
}

function toEmit(history: History): string | undefined {
    const lastEntry = history.entries[history.entries.length - 1];
    if (lastEntry !== undefined && lastEntry.role === "assistant" && !hasToolCalls(lastEntry)) {
        return lastEntry.content;
    }
    return undefined;
}

export async function SimpleAgentWorkflow(
    state: SimpleAgentState,
    events: Array<EventBase>): Promise<WorkflowReducedResult> {
    if (toEmit(state.history)) {
        const completionEvent: CompletionRequest = {
            id: nanoid(),
            type: "CompletionRequest",
            history: state.history,
            tools: state.config.tools
        };
        events.push(completionEvent)
        return {
            state,
            newEvents: events
        }
    }
    throw "unimplemented";
}

SimpleAgentWorkflow satisfies Workflow<any>;
