import { Actor } from "../actor";
import { CompletionResult as CompletionResponse, History } from "../history";
import { ToolMetadata } from "./tool";


export interface CompletionRequest {
    history: History;
    tools: Array<ToolMetadata>;
}

export abstract class CompletionAPI extends Actor<CompletionRequest, CompletionResponse> {
    readonly kind = "completionAPI" as const;

    abstract complete(
        history: History,
        tools: Array<ToolMetadata>,
    ): Promise<CompletionResponse>;

    protected async process(input: CompletionRequest): Promise<ReadonlyArray<CompletionResponse>> {
        return [await this.complete(input.history, input.tools)];
    }
}