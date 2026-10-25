import { z } from "zod";
import { edgeSchema } from "./edge.ts";
import { nodeRecordSchema } from "./node.ts";
import { triggerSchema } from "./trigger.ts";

/**
 * 形状（ADR-0002）：节点记录 + 边 + 触发器。它是快照里的一半持久状态，
 * 运行时可被改写；节点的私有状态与邮箱在另一半（snapshot）。
 */
export const workflowShapeSchema = z.object({
	/** 键就是节点 id：由创建者给，不透明，活节点里唯一（ADR-0002）。 */
	nodes: z.record(z.string().min(1), nodeRecordSchema),
	edges: z.array(edgeSchema),
	triggers: z.array(triggerSchema),
});

export type WorkflowShape = z.infer<typeof workflowShapeSchema>;

export const emptyWorkflowShape = (): WorkflowShape => ({ nodes: {}, edges: [], triggers: [] });
