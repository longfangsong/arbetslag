import { z } from "zod";
import { matchSpecSchema } from "../../matcher.ts";
import { jsonSchema } from "../../message.ts";

/**
 * 工作流对一个图外事件源的订阅（ADR-0001、0015）：不是节点，没有邮箱与私有状态，
 * 但和节点一样可以作为边的起点；输出由 `kind` 声明，接到哪里由边决定。
 *
 * - `listener`：部署里的哪个监听器。引用不存在的监听器不是声明非法，是宿主侧的未就绪。
 * - `match`：唯一的筛选手段，省略即全部。
 * - `group` / `priority`：每个分组是独立的分发域；组内事件只投给命中者里优先级最高的那一层。
 */
export const triggerSchema = z.object({
	/** 与节点 id 共用一个 id 空间：边的 `from` 是其中之一。 */
	id: z.string().min(1),
	kind: z.string().min(1),
	listener: z.string().min(1),
	match: matchSpecSchema.optional(),
	group: z.string().default(""),
	priority: z.number().int().default(0),
	config: jsonSchema.default({}),
});

export type Trigger = z.infer<typeof triggerSchema>;
