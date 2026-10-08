import { JsonValue } from "type-fest";
import { JsonStorage } from "./jsonStorage";

export interface SerializableClass {
    id: string;
    deserialize(json: JsonValue): Serializable;
}

export interface Serializable {
    id: string;
    classId: string;
    serialize(): JsonValue;
}

export class SerializableRegistry {
    classes: Array<SerializableClass> = [];
    register(cls: SerializableClass) {
        this.classes.push(cls);
    }
    get(id: string): SerializableClass | undefined {
        return this.classes.find(cls => cls.id === id);
    }
}
