import { z } from "zod";
import { jsonSchema } from "../../message.ts";

/**
 * 图外事件源的一个实例（ADR-0001）：不是节点，没有邮箱与私有状态，
 * 但和节点一样可以作为边的起点；输出由 `kind` 声明，接到哪里由边决定。
 */
export const triggerSchema = z.object({
	/** 与节点 id 共用一个 id 空间：边的 `from` 是其中之一。 */
	id: z.string().min(1),
	kind: z.string().min(1),
	config: jsonSchema,
});

export type Trigger = z.infer<typeof triggerSchema>;
