import type { JsonValue } from "type-fest";
import type z from "zod";
import type { Message } from "./message";

/// Host 启动时注册每个实现
export interface EffectHandlerDefinition<Config extends JsonValue> {
    name: string;
    configSchema: z.ZodType<Config>;
    handle(config: Config, message: Message): Promise<void>;
};

export interface Repository {
    register(definition: EffectHandlerDefinition<JsonValue>): void;
    get(name: string): EffectHandlerDefinition<JsonValue> | undefined;
}