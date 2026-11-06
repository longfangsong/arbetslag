import type { JsonValue } from "type-fest";
import type z from "zod";
import type { Graph } from "./workflow";

/// Host 启动时注册每个实现
/// 对于不同 Host，外部事件的形状可能不一致，我们只保证同一名字的 TriggerDefinition 输出的 Message 形状一致
export interface Trigger<Config extends JsonValue> {
	name: string;
	configSchema: z.ZodType<Config>;
	// 将 Trigger 和图内的 TriggerSubscription （提供 config）连接起来
	connect(workflow: Graph): void;
};

export interface Repository {
	register(definition: Trigger<JsonValue>): void;
	get(name: string): Trigger<JsonValue> | undefined;
}
