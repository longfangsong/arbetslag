import { Actor } from "../actor";
import { History } from "../history";


export interface ChooseRequest {
    history: History;
    question: string;
    choices: Array<string>,
}

export interface ChooseResponse {
    probabilities: Record<string, string>,
    confidence: number
}

export abstract class ChooseAPI extends Actor<ChooseRequest, ChooseResponse> {
    abstract choose(
        history: History,
        question: string,
        choices: Array<string>,
    ): Promise<ChooseResponse>;

    protected async process(input: ChooseRequest): Promise<void> {
        const result = await this.choose(input.history, input.question, input.choices);
        await this.outputChannel.send(result);
    }
}