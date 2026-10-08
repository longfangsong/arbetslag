import { JsonObject, JsonValue } from "type-fest";
import { Workflow } from "./workflow";

export type EventBase = JsonObject & {
    id: string;
    type: string;
}

interface Session {
    id: string;
    state: JsonValue;
    workflow: Workflow;
}