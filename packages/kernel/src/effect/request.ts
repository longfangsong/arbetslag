import { z } from "zod";
import { jsonSchema } from "../message.ts";

/**
 * 节点在一条转移里交出的一次外部动作请求（ADR-0006）：全是数据。
 * `correlationId` 由作者给，内核原样带回，让节点把回执和当初的请求对上；
 * `effectId` 是内核的幂等键，step 看不见。
 */
export const effectRequestSchema = z.object({
	kind: z.string().min(1),
	input: jsonSchema,
	correlationId: z.string().min(1).optional(),
});

export type EffectRequest = z.infer<typeof effectRequestSchema>;
