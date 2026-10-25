import { z } from "zod";
import { jsonSchema } from "../../message.ts";
import { edgeSchema } from "../shape/edge.ts";
import { triggerSchema } from "../shape/trigger.ts";

const id = z.string().min(1);

/**
 * 改图的操作（ADR-0002）。判别字段是 `op`（conventions.md）。
 * 一批操作放在同一个 `graph.mutate` 效果里，按固定顺序应用：
 * 新增（spawn / addTrigger）→ 断线 → 接线 → 回收（retire / removeTrigger）。
 */
export const graphOpSchema = z.discriminatedUnion("op", [
	z.object({
		op: z.literal("spawn"),
		id,
		definition: z.string().min(1),
		config: jsonSchema,
		/** 省略时同实例化：由定义的 `state` schema 解析 `undefined`。 */
		state: jsonSchema.optional(),
	}),
	/** 回收节点：连带删边（含从触发器出发的）、邮箱、以 origin 为它的在飞记录。 */
	z.object({ op: z.literal("retire"), id }),
	z.object({ op: z.literal("connect"), ...edgeSchema.shape }),
	/** 按完整的边（`from`、`to`、`port`）删除，必须存在。 */
	z.object({ op: z.literal("disconnect"), ...edgeSchema.shape }),
	z.object({ op: z.literal("addTrigger"), ...triggerSchema.shape }),
	/** 删除触发器：连带删从它出发的边。 */
	z.object({ op: z.literal("removeTrigger"), id }),
]);

export type GraphOp = z.infer<typeof graphOpSchema>;
