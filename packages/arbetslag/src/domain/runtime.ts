import { JsonValue } from "type-fest";
import { JsonStorage } from "./jsonStorage";
import { Workflow } from "./workflow";

export interface Runtime {
    store: JsonStorage;
    workflows: Record<string, Workflow<JsonValue>>;
}