import { getAllReadyHistory, State } from "./model/state";

export function poll(state: State): boolean {
    const readyHistory = getAllReadyHistory(state);
    if (!readyHistory) {

    }
}