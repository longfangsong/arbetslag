import type { JsonValue } from "type-fest";
import { z } from "zod";
import { EFFECT_END, type Message, jsonSchema } from "../message.ts";
import type { InFlightEffect } from "./inFlight.ts";

/** `@effect.end` 的 body：内核包的一层，`result` 才是效果种类声明的形状（ADR-0006）。 */
export const receiptBodySchema = z.object({
	correlationId: z.string().min(1).optional(),
	result: jsonSchema,
});

export type ReceiptBody = z.infer<typeof receiptBodySchema>;

/**
 * 把执行器给的结果变成要追加进 origin 邮箱的回执。
 * 没有 `from`：回给谁在记录里，不在消息上。
 */
export function makeReceipt(effect: InFlightEffect, result: JsonValue): Message {
	const body: ReceiptBody = { result };
	if (effect.correlationId !== undefined) body.correlationId = effect.correlationId;
	return { type: EFFECT_END, body };
}
