import z from "zod";
import type {
  Tool,
  ToolCallDoneEvent,
  ToolCallRequestEvent,
} from "../../../model/tool";
import type { Event } from "../../..";
import type { State } from "../../../model/state";
import type { LLMCompletionDoneEvent } from "../../../model/llmProvider";
import type { CompletionResult, HistoryEntry } from "../../../model/history";

const WaitAgentInputSchema = z
  .object({
    id: z.string().describe("Id of the agent to wait for."),
  })
  .strict();

export interface WaitAgentResult {
  output: string;
}

export class WaitAgent implements Tool<z.infer<typeof WaitAgentInputSchema>> {
  id: string = "wait_agent";
  description: string =
    "Wait for an agent to complete its task and return its result. The call blocks until the agent has finished.";
  inputSchema = WaitAgentInputSchema;
  async call(state: State, event: Event): Promise<State> {
    const typedEvent = event as ToolCallRequestEvent<
      z.infer<typeof WaitAgentInputSchema>
    >;
    const agent = state.persistent.agents.find(
      (a) => a.id === typedEvent.input.id,
    )!;
    const history = state.persistent.histories.find(
      (h) => h.id === agent.historyId,
    )!;
    const lastEntry = history.entries[history.entries.length - 1]!;

    function resultEvent(output: string): Event {
      return {
        type: "toolCallDone",
        id: typedEvent.id,
        callerId: typedEvent.callerId,
        output: {
          output,
        },
      } as ToolCallDoneEvent<WaitAgentResult>;
    }

    if (this.isCompleted(lastEntry)) {
      // The agent has already finished its task and returned a result.
      state.runtime.eventBus.push(resultEvent(lastEntry.content));
      return state;
    }
    // Wait for the agent to finish its task and return a result.
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
          state.runtime.eventBus.push(
            resultEvent(completionEvent.result.content),
          );
          return state;
        },
      },
    ]);
    return state;
  }

  private isCompleted(lastEntry: HistoryEntry): lastEntry is CompletionResult {
    return (
      lastEntry.role === "assistant" &&
      (lastEntry.toolCalls === undefined || lastEntry.toolCalls?.length === 0)
    );
  }
}
