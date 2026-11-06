import type { JsonValue } from "type-fest";
import z from "zod";
import type { Host } from "..";
import { newId } from "../utils";
import type { Message } from "../message";

export const schema = z.object({
    id: z.string().min(1),
    definitionName: z.string().min(1),
    config: z.json() as z.ZodType<JsonValue>,
});

export class Trigger {
    id: string;
    definitionName: string
    config: JsonValue;
    
    constructor(id: string, definitionName: string, config: JsonValue) {
        this.id = id;
        this.definitionName = definitionName;
        this.config = config;
    }

    create(host: Host, definitionName: string, config: JsonValue): Trigger {
        const triggerDefinition = host.triggerDefinitionRepository.get(definitionName);
        if (!triggerDefinition) {
            throw new Error(`Trigger definition ${definitionName} not found`);
        }
        return new Trigger(newId(), definitionName, config);
    }

    static deserialize(data: z.infer<typeof schema>): Trigger {
        return new Trigger(data.id, data.definitionName, data.config);
    }

    serialize(): z.infer<typeof schema> {
        return {
            id: this.id,
            definitionName: this.definitionName,
            config: this.config,
        };
    }

    convert(host: Host, external: any): Promise<Message | null> {
        const triggerDefinition = host.triggerDefinitionRepository.get(this.definitionName);
        if (!triggerDefinition) {
            throw new Error(`Trigger definition ${this.definitionName} not found`);
        }
        let result = triggerDefinition.convert(this.config, external);
        return result.then(message => {
            if (message) {
                message.triggerId = this.id;
            }
            return message;
        });
    }
}