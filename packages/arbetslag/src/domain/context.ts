import { Agent } from "./agent";
import { Template } from "./agent/template";
import { JsonStorage } from "./jsonStorage";
import { SerializableRegistry } from "./serializable";

export class Context {
    serializableRegistry: SerializableRegistry;
    storage: JsonStorage;
    
    constructor(serializableRegistry: SerializableRegistry, storage: JsonStorage) {
        this.serializableRegistry = serializableRegistry;
        this.storage = storage;

        this.serializableRegistry.register(Agent);
        this.serializableRegistry.register(Template);
    }
}