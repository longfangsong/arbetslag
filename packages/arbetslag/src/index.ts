import type { State } from "./model/state";

export interface Event {
  type: string;
}

export interface Reducer<E extends Event> {
  call(state: State, event: E): Promise<State>;
}
