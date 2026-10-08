import { JsonValue } from "type-fest";

export interface JsonStorage {
    get(key: string): Promise<JsonValue | undefined>;
    set(key: string, value: JsonValue): Promise<void>;
    delete(key: string): Promise<void>;
}
