import { Actor } from "../actor";
import { CompletionResult as CompletionResponse, History } from "../history";
import { ToolMetadata } from "./tool";


export interface CompletionRequest {
    history: History;
    tools: Array<ToolMetadata>;
}

export abstract class CompletionAPI extends Actor<CompletionRequest, CompletionResponse> {
    abstract complete(
        history: History,
        tools: Array<ToolMetadata>,
    ): Promise<CompletionResponse>;

    protected async process(input: CompletionRequest): Promise<void> {
        const result = await this.complete(input.history, input.tools);
        await this.outputChannel.send(result);
    }
}