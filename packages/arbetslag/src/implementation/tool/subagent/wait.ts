import z from "zod";
import { Tool, ToolCallDoneEvent, ToolCallRequestEvent, ToolCallRequestEvent } from "../../../model/tool";
import { Event } from "../../..";
import { State } from "../../../model/state";
import { LLMCompletionDoneEvent } from "../../../model/llmProvider";
import { LLMCompletionDoneEvent } from "../../../model/llmProvider";
import { HistoryEntry } from "../../../model/history";

const WaitAgentInputSchema = z
    .object({
        template: z
            .string()
            .describe("Id of the agent to wait for."),
    })
    .strict();

export interface WaitAgentResult {
    output: string;
}

export class WaitAgent implements Tool<
    z.infer<typeof WaitAgentInputSchema>
> {
    id: string = "wait_agent";
    description: string =
        "Wait for a Sub-agent to complete its task and return its result. The call blocks until the agent has finished.";
    inputSchema = WaitAgentInputSchema;
    async call(state: State, event: Event): Promise<State> {
        const typedEvent = event as ToolCallRequestEvent<z.infer<typeof WaitAgentInputSchema>>;
        const history = state.persistent.histories.find((h) => h.id === typedEvent.input.template)!;
        const lastEntry = history.entries[history.entries.length - 1]!;

        if (this.isCompleted(lastEntry)) {
            // The agent has finished its task and returned a result.
            state.runtime.eventBus.push({
                type: "toolCallDone",
                id: typedEvent.id,
                callerId: typedEvent.callerId,
                output: {
                    output: lastEntry.content,
                },
            } as ToolCallDoneEvent<WaitAgentResult>);
            return state;
        }
        state.runtime.waiting.push([
            (e: Event) => {
                if (e.type !== "llmCompletionDone") {
                    return false;
                }
                const typedEvent = e as LLMCompletionDoneEvent;
                return this.isCompleted(typedEvent.result);
            },
            {
                call: async (state: State, event: Event): Promise<State> => {
                    const completionEvent = event as LLMCompletionDoneEvent;
                    state.runtime.eventBus.push({
                        type: "toolCallDone",
                        id: typedEvent.id,
                        callerId: typedEvent.callerId,
                        output: {
                            output: completionEvent.result.content,
                        },
                    } as ToolCallDoneEvent<WaitAgentResult>);
                    return state;
                },
            },
        ]);
        return state;
    }

    private isCompleted(lastEntry: HistoryEntry) {
        return lastEntry.role === "assistant" && (lastEntry.toolCalls === undefined || lastEntry.toolCalls?.length === 0);
    }
}