import { JsonValue } from "type-fest";
import { EventBase } from "./event";

export type WorkflowReducedResult = {
    state: JsonValue;
    newEvents: Array<EventBase>
};

export type Workflow<S extends JsonValue> = (state: S, events: Array<EventBase>) => Promise<WorkflowReducedResult>;
