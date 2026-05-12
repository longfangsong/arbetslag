import { State } from "@/application/orchestrator";

export interface Tool<I, O> {
    name: string;
    description: string;
    call(state: State, input: I): Promise<O>;
}