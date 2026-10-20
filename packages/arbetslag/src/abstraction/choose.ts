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
    readonly kind = "chooseAPI" as const;

    abstract choose(
        history: History,
        question: string,
        choices: Array<string>,
    ): Promise<ChooseResponse>;

    protected async process(input: ChooseRequest): Promise<ReadonlyArray<ChooseResponse>> {
        return [await this.choose(input.history, input.question, input.choices)];
    }
}