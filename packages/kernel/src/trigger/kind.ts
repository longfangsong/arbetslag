import type { JsonValue } from "type-fest";
import type { z } from "zod";

/**
 * 宿主注册的一种触发器（ADR-0001）：名字、config schema、输出声明。
 * 内核认 schema，不认行为；监听的实现归宿主。
 */
export type TriggerKindDefinition<Config extends JsonValue = JsonValue> = {
	kind: string;
	config: z.ZodType<Config>;
	/** config 的纯函数：`{ 输出名: body schema }`，与节点定义的 `ports` 同构。 */
	outputs(config: Config): Record<string, z.ZodType<JsonValue>>;
};
