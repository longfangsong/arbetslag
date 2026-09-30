import z from "zod";
import { CompletionResult, History } from "./history";
import { Result } from "neverthrow";
import { Tool } from "./tool";

export interface LLMProvider {
    id: string;
    complete(
        model: string,
        history: History,
        tools: Array<Tool<unknown, unknown, unknown>>,
        outputSchema?: z.ZodType,
    ): Promise<Result<CompletionResult, string>>;
}