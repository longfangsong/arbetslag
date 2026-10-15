import { JsonValue } from "type-fest";

export interface InputAdapter {
    readonly id: string;
    receive(payload: JsonValue): Promise<JsonValue & {toId: string}>;
}
