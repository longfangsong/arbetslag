import { z } from "zod";
import { jsonSchema } from "../../message.ts";

/** 节点记录：这个位置上是哪份节点定义、用什么 config。 */
export const nodeRecordSchema = z.object({
	/** 节点定义的名字（注册表里每个名字只有当前一版，ADR-0004）。 */
	definition: z.string().min(1),
	config: jsonSchema,
});

export type NodeRecord = z.infer<typeof nodeRecordSchema>;
