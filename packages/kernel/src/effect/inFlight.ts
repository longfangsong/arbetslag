import { z } from "zod";
import { jsonSchema } from "../message.ts";

/**
 * 在飞记录（ADR-0003、0006）：进快照，回执回来即删，不留历史。
 * 它同时是回执的一次性令牌：追加邮箱与删记录是同一次 CAS 写。
 */
export const inFlightEffectSchema = z.object({
	/** 内核的幂等键；崩溃后重新交给执行器时保持不变。step 看不见。 */
	effectId: z.string().min(1),
	/** 回执回到哪个节点，在交出那一刻就定死。 */
	origin: z.string().min(1),
	kind: z.string().min(1),
	input: jsonSchema,
	correlationId: z.string().min(1).optional(),
});

export type InFlightEffect = z.infer<typeof inFlightEffectSchema>;
