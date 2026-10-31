import type { InFlightEffect } from "../effect/index.ts";
import type { Registry } from "../registry.ts";
import type { SnapshotStore } from "../snapshotStore.ts";
import { type TransitionLog, appendLog } from "../transitionLog.ts";
import { type AdvanceOptions, advance } from "./advance.ts";

export const DEFAULT_BUDGET = 1000;
/** 单条快照 2 MB（ADR-0002）。 */
export const DEFAULT_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export type RunOptions = Partial<AdvanceOptions> & { log?: TransitionLog };

export type RunResult = {
	status: "quiescent" | "budget" | "halted";
	steps: number;
	/** 本次新交出的效果：已随快照落盘，现在可以交给执行器了（ADR-0003）。 */
	effects: InFlightEffect[];
};

/**
 * 一次 Run（ADR-0003、0007）：`advance` 在存储的临界区里跑，有没有改动、改成了什么，
 * 都在同一次原子写入里决定（ADR-0013）。已停住的工作流空转返回；预算用完不是停住。
 * 日志在落盘之后才写：没落盘的推进不该留下记录。
 */
export async function run(
	store: SnapshotStore,
	registry: Registry,
	id: string,
	options: RunOptions = {},
): Promise<RunResult> {
	const resolved: AdvanceOptions = {
		budget: options.budget ?? DEFAULT_BUDGET,
		maxSnapshotBytes: options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES,
		now: options.now ?? (() => new Date()),
		newEffectId: options.newEffectId ?? (() => crypto.randomUUID()),
	};

	const outcome = await store.commit(id, (snapshot) => {
		const advanced = advance(registry, snapshot, resolved);
		return { snapshot: advanced.changed ? advanced.snapshot : undefined, value: advanced };
	});

	if (outcome.changed) await appendLog(options.log, id, outcome.log);
	return { status: outcome.status, steps: outcome.steps, effects: outcome.effects };
}

/**
 * 解除停住（ADR-0008）：只清掉标记，仅此而已——不修快照，修复靠改部署。
 * 之后下一次 `run` 会重新处理队首那条消息。没停住则什么都不做，返回 `false`。
 */
export async function resume(store: SnapshotStore, id: string): Promise<boolean> {
	return store.commit(id, (snapshot) => {
		if (snapshot.halted === undefined) return { value: false };
		const { halted: _, ...rest } = snapshot;
		return { snapshot: rest, value: true };
	});
}
