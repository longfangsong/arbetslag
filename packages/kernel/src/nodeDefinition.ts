import type { JsonValue } from "type-fest";
import z from "zod";
import type { Message } from "./message";

export type StepOutput<State extends JsonValue> = {
    state: State;
    sendMessages: Array<Message>;
};

/// Host 启动时注册每个实现
export interface NodeDefinition<State extends JsonValue, Config extends JsonValue> {
    name: string;
    configSchema: z.ZodType<Config>;
    stateSchema: z.ZodType<State>;
    outboundMessageSchema: Array<z.ZodType<Message>>;

    initialize(config: Config): State;
    step(config: Config, state: State, message: Message): StepOutput<State>;
};

export interface Repository {
    register(definition: NodeDefinition<JsonValue, JsonValue>): void;
    get(name: string): NodeDefinition<JsonValue, JsonValue> | undefined;
}