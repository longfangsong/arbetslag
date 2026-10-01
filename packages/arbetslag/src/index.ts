import { State } from "./model/state";

export interface Event {
    type: string;
}

export interface Reducer {
    call(state: State, event: Event): Promise<State>;
}