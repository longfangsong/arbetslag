import type z from "zod";
import type { Event, Reducer } from "..";
import type { CompletionResult } from "./history";

export interface LLMCompletionRequestEvent extends Event {
  type: "llmCompletionRequest";
  llmProviderId: string;
  historyId: string;
  toolIds: Array<string>;
  outputSchema?: z.ZodType;
}

export interface LLMCompletionDoneEvent extends Event {
  type: "llmCompletionDone";
  result: CompletionResult;
}

export interface LLMProvider extends Reducer<LLMCompletionRequestEvent> {
  id: string;
}
