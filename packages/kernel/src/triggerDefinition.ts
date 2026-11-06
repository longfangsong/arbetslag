import type { JsonValue } from "type-fest";
import type z from "zod";
import type { Message } from "./message";

/// Host 启动时注册每个实现
/// 对于不同 Host，外部事件的形状可能不一致，我们只保证同一名字的 TriggerDefinition 输出的 Message 形状一致
export type TriggerDefinition<Config extends JsonValue> = {
	name: string;
	configSchema: z.ZodType<Config>;
	// 接受 一个 外部事件，将其转换为 Message
	convert(config: Config, external: any): Promise<Message | null>;
};

export interface Repository {
	register(definition: TriggerDefinition<JsonValue>): void;
	get(name: string): TriggerDefinition<JsonValue> | undefined;
}