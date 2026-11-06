import type { JsonValue } from "type-fest";

export interface Store {
    get<T extends JsonValue>(id: string): Promise<T>;
    set<T extends JsonValue>(id: string, value: T): Promise<void>;
}