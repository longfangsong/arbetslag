import type { JsonValue } from "type-fest";
import { z } from "zod";
import type { StepOutput } from "../nodeDefinition";
import type { Host } from "..";
import type { Message } from "../message";
import { newId } from "../utils";

export const schema = z.object({
    id: z.string().min(1),
    definitionName: z.string().min(1),
    config: z.json() as z.ZodType<JsonValue>,
    state: z.json() as z.ZodType<JsonValue>,
});

export class Node {
    id: string;
    definitionName: string
    config: JsonValue;
    state: JsonValue;
    inputBox: Array<Message>;

    constructor(id: string, definitionName: string, config: JsonValue, state: JsonValue) {
        this.id = id;
        this.definitionName = definitionName;
        this.config = config;
        this.state = state;
        this.inputBox = [];
    }

    create(host: Host, definitionName: string, config: JsonValue): Node {
        const nodeDefinition = host.nodeDefinitionRepository.get(this.definitionName);
        if (!nodeDefinition) {
            throw new Error(`Node definition ${this.definitionName} not found`);
        }
        const state = nodeDefinition.initialize(config);
        return new Node(newId(), definitionName, config, state);
    }

    static deserialize(data: z.infer<typeof schema>): Node {
        return new Node(data.id, data.definitionName, data.config, data.state);
    }

    serialize(): z.infer<typeof schema> {
        return {
            id: this.id,
            definitionName: this.definitionName,
            config: this.config,
            state: this.state,
        };
    }

    private step(host: Host, message: Message): StepOutput<JsonValue> {
        const nodeDefinition = host.nodeDefinitionRepository.get(this.definitionName);
        if (!nodeDefinition) {
            throw new Error(`Node definition ${this.definitionName} not found`);
        }
        return nodeDefinition.step(this.config, this.state, message);
    }

    stepUntilEmpty(host: Host): Array<Message> {
        const sendMessages: Array<Message> = [];
        while (this.inputBox.length > 0) {
            const message = this.inputBox.shift()!;
            const stepOutput = this.step(host, message);
            sendMessages.push(...stepOutput.sendMessages);
            this.state = stepOutput.state;
        }
        return sendMessages;
    }
}
