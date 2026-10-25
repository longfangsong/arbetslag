import { z } from "zod";
import { nodeStateSchema } from "./nodeState.ts";
import { workflowShapeSchema, type WorkflowShape } from "../shape/index.ts";

/**
 * 图 = 形状 + 每个节点的私有状态与邮箱（CONTEXT.md）。
 * 改图同时改两边：新增一个节点给它一份状态与邮箱，回收一个节点同时带走它们。
 */
export const workflowGraphSchema = z.object({
	shape: workflowShapeSchema,
	/** 键与 `shape.nodes` 一一对应。 */
	nodeStates: z.record(z.string().min(1), nodeStateSchema),
});

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const emptyWorkflowGraph = (shape?: WorkflowShape): WorkflowGraph => ({
	shape: shape ?? { nodes: {}, edges: [], triggers: [] },
	nodeStates: {},
});
