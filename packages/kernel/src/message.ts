import type { JsonValue } from "type-fest";
import { z } from "zod";

/** 前缀保留给内核：应用（节点）不得使用，ADR-0005。 */
export const RESERVED_PREFIX = "@";

/** 效果回执的类别，由内核写，ADR-0006。 */
export const EFFECT_END = "@effect.end";

export const jsonSchema: z.ZodType<JsonValue> = z.json();

/**
 * 图内唯一的信封（ADR-0005）：谁发的、哪一类、载荷。
 * 目标不在信封上，也没有内核 id。
 */
export const messageSchema = z.object({
	/** 发件节点的 id；图外投递与效果回执没有。 */
	from: z.string().min(1).optional(),
	/** 发送方出口（端口）的名字，同时是接收方分派的依据。 */
	type: z.string().min(1),
	body: jsonSchema,
});

export type Message = z.infer<typeof messageSchema>;

export function isReservedType(type: string): boolean {
	return type.startsWith(RESERVED_PREFIX);
}
