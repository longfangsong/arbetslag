import type { InFlightEffect } from "../effect/index.ts";
import type { Registry } from "../registry.ts";
import { Conflict, type SnapshotStore } from "../snapshotStore.ts";
import { type TransitionLog, appendLog } from "../transitionLog.ts";
import { type AdvanceOptions, advance } from "./advance.ts";
import { MAX_ATTEMPTS, update } from "./update.ts";
import { WorkflowNotFound } from "../errors.ts";

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
 * 一次 Run（ADR-0003、0007）：载入快照 → `advance` → 有改动才带版本写回。
 * 冲突就丢掉内存里的一切推进、重载、重跑，≤3 次后抛 `Conflict`。
 * 已停住的工作流空转返回；预算用完不是停住，再调一次接着推。
 * 日志在落盘之后才写，所以被冲突作废的那几次不会留下记录。
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

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const loaded = await store.load(id);
		if (loaded === undefined) throw new WorkflowNotFound(id);

		const outcome = advance(registry, loaded.snapshot, resolved);
		if (outcome.changed) {
			try {
				await store.save(id, outcome.snapshot, loaded.revision);
			} catch (error) {
				if (error instanceof Conflict && error.reason === "stale") continue;
				throw error;
			}
			await appendLog(options.log, id, outcome.log);
		}
		return { status: outcome.status, steps: outcome.steps, effects: outcome.effects };
	}
	throw new Conflict(id, "stale");
}

/**
 * 解除停住（ADR-0008）：只清掉标记，仅此而已——不修快照，修复靠改部署。
 * 之后下一次 `run` 会重新处理队首那条消息。没停住则什么都不做，返回 `false`。
 */
export async function resume(store: SnapshotStore, id: string): Promise<boolean> {
	return update(store, id, (snapshot) => {
		if (snapshot.halted === undefined) return { value: false };
		const { halted: _, ...rest } = snapshot;
		return { snapshot: rest, value: true };
	});
}
