import type { JsonValue } from "type-fest";
import type { z } from "zod";

/**
 * 宿主注册的一种效果（ADR-0006）：名字、`input` schema、回执结果 schema。
 * 内核只用它校验，从不执行。
 */
export type EffectKindDefinition = {
	kind: string;
	input: z.ZodType<JsonValue>;
	/** `@effect.end` 的 `body.result` 的形状；成功与失败是它的两种形状。 */
	result: z.ZodType<JsonValue>;
};
