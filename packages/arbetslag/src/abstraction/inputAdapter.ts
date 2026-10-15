import { JsonValue } from "type-fest";

export interface InputAdapter {
    readonly id: string;
    processable(payload: JsonValue): Promise<boolean>;
    receive(payload: JsonValue): Promise<JsonValue>;
}
