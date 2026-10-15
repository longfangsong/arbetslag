import { JsonValue } from "type-fest";

export interface OutputAdapter {
    readonly id: string;
    deliver(payload: JsonValue): Promise<void>;
}