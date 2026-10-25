import { checkWorkflowShape, type WorkflowShapeViolation } from "../shape/index.ts";
import type { WorkflowGraph } from "./graph.ts";

export type WorkflowGraphViolation =
	| WorkflowShapeViolation
	| { code: "node_state_missing"; id: string }
	| { code: "node_state_orphan"; id: string }
	| { code: "mailbox_unordered"; id: string };

/**
 * 图的结构不变量：形状自身的不变量，加上形状与节点状态一一对应、
 * 每个邮箱里的 `seq` 严格递增。
 */
export function checkWorkflowGraph(graph: WorkflowGraph): WorkflowGraphViolation[] {
	const violations: WorkflowGraphViolation[] = checkWorkflowShape(graph.shape);

	for (const id of Object.keys(graph.shape.nodes)) {
		if (!Object.hasOwn(graph.nodeStates, id)) violations.push({ code: "node_state_missing", id });
	}
	for (const [id, node] of Object.entries(graph.nodeStates)) {
		if (!Object.hasOwn(graph.shape.nodes, id)) {
			violations.push({ code: "node_state_orphan", id });
			continue;
		}
		const ordered = node.mailbox.every((entry, i) => i === 0 || entry.seq > (node.mailbox[i - 1]?.seq ?? -1));
		if (!ordered) violations.push({ code: "mailbox_unordered", id });
	}
	return violations;
}
