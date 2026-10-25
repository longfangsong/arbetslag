import { z } from "zod";
import { inFlightEffectSchema } from "../effect/index.ts";
import { haltReasonSchema } from "../halt.ts";
import {
	checkWorkflowGraph,
	workflowGraphSchema,
	type WorkflowGraphViolation,
} from "./graph/index.ts";

/**
 * 一份工作流的完整持久形态（ADR-0003）：图、在飞的 effect、内核簿记。
 * 它是唯一的事实来源；版本（CAS）由 Store 管，不在快照里。
 */
export const snapshotSchema = z.object({
	graph: workflowGraphSchema,
	inFlight: z.array(inFlightEffectSchema),
	/** 下一个入队序号（ADR-0007）：单调递增。 */
	nextSeq: z.number().int().nonnegative(),
	/** 有值即停住：整份工作流停住，等人 `resume`（ADR-0008）。 */
	halted: haltReasonSchema.optional(),
});

export type Snapshot = z.infer<typeof snapshotSchema>;

export const isHalted = (snapshot: Snapshot): boolean => snapshot.halted !== undefined;

/** 静止：所有邮箱为空。可能仍有在飞的 effect（ADR-0003）。 */
export const isQuiescent = (snapshot: Snapshot): boolean =>
	Object.values(snapshot.graph.nodeStates).every((node) => node.mailbox.length === 0);

/**
 * 需要恢复（ADR-0003）：该跑一次 Run（active 且邮箱非空），
 * 或有在飞 effect（该把同一个 `effectId` 重新交给执行器）。
 * 谁去扫归宿主；内核只定义什么叫需要恢复。
 */
export function needsRecovery(snapshot: Snapshot): { run: boolean; effects: boolean } {
	return {
		run: !isHalted(snapshot) && !isQuiescent(snapshot),
		effects: snapshot.inFlight.length > 0,
	};
}

export type SnapshotViolation =
	| WorkflowGraphViolation
	| { code: "mailbox_seq_ahead"; id: string }
	| { code: "in_flight_orphan"; effectId: string; origin: string }
	| { code: "in_flight_duplicate_id"; effectId: string };

/**
 * 快照的结构不变量：图的不变量，加上邮箱序号都小于 `nextSeq`、
 * 在飞记录的 `origin` 是活节点（origin 被回收则记录一并丢弃）、`effectId` 不重复。
 */
export function checkSnapshot(snapshot: Snapshot): SnapshotViolation[] {
	const violations: SnapshotViolation[] = checkWorkflowGraph(snapshot.graph);

	for (const [id, node] of Object.entries(snapshot.graph.nodeStates)) {
		if (node.mailbox.some((entry) => entry.seq >= snapshot.nextSeq)) {
			violations.push({ code: "mailbox_seq_ahead", id });
		}
	}

	const seen = new Set<string>();
	for (const effect of snapshot.inFlight) {
		if (seen.has(effect.effectId)) {
			violations.push({ code: "in_flight_duplicate_id", effectId: effect.effectId });
		}
		seen.add(effect.effectId);
		if (!Object.hasOwn(snapshot.graph.shape.nodes, effect.origin)) {
			violations.push({ code: "in_flight_orphan", effectId: effect.effectId, origin: effect.origin });
		}
	}
	return violations;
}
