import type { JsonValue } from "type-fest";
import { makeReceipt } from "../effect/index.ts";
import type { Registry } from "../registry.ts";
import type { SnapshotStore } from "../snapshotStore.ts";
import type { Snapshot } from "../workflow/snapshot.ts";
import { applyGraphMutation, graphMutationResult } from "../workflow/graph/mutation.ts";
import { graphOpSchema } from "../workflow/graph/ops.ts";

/**
 * 把一个效果的结果落成回执（ADR-0006）：删掉那条在飞记录，给 origin 追加 `@effect.end`。
 * 记录就是一次性令牌：它不在了（已经落过、或 origin 被回收时一并丢弃）就返回 `undefined`，
 * 结果丢弃——对图 exactly-once。纯函数，不改入参。
 */
export function settleEffect(snapshot: Snapshot, effectId: string, result: JsonValue): Snapshot | undefined {
	const at = snapshot.inFlight.findIndex((effect) => effect.effectId === effectId);
	const effect = snapshot.inFlight[at];
	if (effect === undefined) return undefined;

	const next = structuredClone(snapshot);
	next.inFlight.splice(at, 1);
	const origin = next.graph.nodeStates[effect.origin];
	if (origin !== undefined) {
		origin.mailbox.push({ seq: next.nextSeq++, message: makeReceipt(effect, result) });
	}
	return next;
}

/**
 * 执行器把效果的结果交回来：追加回执、删记录，同一次 CAS 写（ADR-0006）。
 * 停住的工作流照收（ADR-0008），但不触发 `run`。
 * 记录已经不在则什么都不做，返回 `false`。
 */
export async function completeEffect(
	store: SnapshotStore,
	id: string,
	effectId: string,
	result: JsonValue,
): Promise<boolean> {
	return store.commit(id, (snapshot) => {
		const next = settleEffect(snapshot, effectId, result);
		return next === undefined ? { value: false } : { snapshot: next, value: true };
	});
}

export type GraphMutateOutcome = "applied" | "rejected" | "skipped";

/**
 * 执行一条 `graph.mutate` 效果（ADR-0002、0006）：应用改动、删在飞记录、追加回执，同一次写入。
 * - `applied`：改动生效，回执 `{ ok: true }`
 * - `rejected`：违规，改动不生效，回执 `{ ok: false, violations }`
 * - `skipped`：什么都没做——记录已不在，或工作流已停住（停住期间内核不推进，
 *   `resume` 之后恢复扫描会再把这条效果交出来）
 */
export async function performGraphMutate(
	store: SnapshotStore,
	registry: Registry,
	id: string,
	effectId: string,
): Promise<GraphMutateOutcome> {
	return store.commit<GraphMutateOutcome>(id, (snapshot) => {
		if (snapshot.halted !== undefined) return { value: "skipped" };
		const effect = snapshot.inFlight.find((e) => e.effectId === effectId);
		if (effect === undefined) return { value: "skipped" };
		if (effect.kind !== "graph.mutate") {
			throw new Error(`effect ${effectId} is ${effect.kind}, not graph.mutate`);
		}

		const ops = graphOpSchema.array().parse((effect.input as { ops: unknown }).ops);
		const result = applyGraphMutation(registry, snapshot, ops);
		const base = result.ok ? result.snapshot : snapshot;
		// 节点把自己回收了：它那条记录随之被丢弃，回执没有去处，但改动要保存。
		const settled = settleEffect(base, effectId, graphMutationResult(result)) ?? (result.ok ? base : undefined);
		if (settled === undefined) return { value: "skipped" };
		return { snapshot: settled, value: result.ok ? "applied" : "rejected" };
	});
}
