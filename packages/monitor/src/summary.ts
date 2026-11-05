import { type Snapshot, isQuiescent } from "@arbetslag/kernel";
import type { WorkflowStatus, WorkflowSummary } from "./protocol.ts";

/** 停住优先；其余按邮箱、再按在飞效果（ADR-0003 的「需要恢复」也是这两条）。 */
export function statusOf(snapshot: Snapshot): WorkflowStatus {
	if (snapshot.halted !== undefined) return "halted";
	if (!isQuiescent(snapshot)) return "runnable";
	return snapshot.inFlight.length > 0 ? "in_flight" : "quiescent";
}

export function summarize(id: string, snapshot: Snapshot, executing: number): WorkflowSummary {
	const { shape, nodeStates } = snapshot.graph;
	return {
		id,
		status: statusOf(snapshot),
		...(snapshot.halted === undefined ? {} : { halted: snapshot.halted }),
		nodes: Object.keys(shape.nodes).length,
		triggers: shape.triggers.length,
		mailbox: Object.values(nodeStates).reduce((sum, node) => sum + node.mailbox.length, 0),
		inFlight: snapshot.inFlight.length,
		executing,
	};
}
