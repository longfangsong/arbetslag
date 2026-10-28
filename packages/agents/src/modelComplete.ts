import type { JsonValue } from "type-fest";
import type { EffectKindDefinition } from "@arbetslag/kernel";
import { z } from "zod";
import { historyMessageSchema, historySchema } from "./history.ts";
import { toolSpecSchema } from "./tool.ts";

const jsonSchema: z.ZodType<JsonValue> = z.json();

/**
 * `model.complete` 效果的输入（ADR-0009）：厂商无关。
 * `params` 是厂商特有的旋钮，agents 包不解释它，由对应的 **Performer** 包接手。
 */
export const modelCompleteInputSchema = z.object({
	model: z.string().min(1),
	messages: historySchema,
	tools: z.array(toolSpecSchema).default([]),
	params: jsonSchema.optional(),
});

/** 回执：成功带回一条 assistant 消息，失败带回一句话（成功与失败都是结果，ADR-0006）。 */
export const modelCompleteResultSchema = z.union([
	z.object({ ok: z.literal(true), message: historyMessageSchema }),
	z.object({ ok: z.literal(false), error: z.string() }),
]);

export type ModelCompleteInput = z.infer<typeof modelCompleteInputSchema>;
export type ModelCompleteResult = z.infer<typeof modelCompleteResultSchema>;

/** 效果种类本身：内核只认名字与两份 schema（ADR-0006）。 */
export const modelCompleteKind: EffectKindDefinition = {
	kind: "model.complete",
	input: modelCompleteInputSchema,
	result: modelCompleteResultSchema,
};
