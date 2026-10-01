import z from "zod";
import { Event, Reducer } from "..";
import { CompletionResult } from "./history";

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

export interface LLMProvider extends Reducer {
    id: string;
}