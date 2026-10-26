import { isHalted, needsRecovery } from "@arbetslag/kernel";
import type { DriveResult } from "./executor.ts";
import { type Host, drive } from "./host.ts";
import type { WorkflowIndex } from "./workflowIndex.ts";

/**
 * 一次恢复扫描的结果。每一份工作流恰好落进其中一栏，坏掉的那几份不挡别人。
 */
export type RecoveryReport = {
	/** 索引里有多少 id。 */
	scanned: number;
	/** 有活要干、已经推完的（含只补交在飞效果的）。 */
	advanced: { id: string; result: DriveResult }[];
	/** 什么都不用做。 */
	quiescent: string[];
	/** 停住：等人 `resume`，扫描不动它。 */
	halted: string[];
	/** 索引里有、store 里没有（过期索引）。 */
	missing: string[];
	/** 载入或推进失败：损坏的快照、缺 Performer、CAS 冲突用尽。 */
	failed: { id: string; error: unknown }[];
};

export type RecoverOptions = {
	/** 每推完一份调一次（日志、指标）。 */
	onAdvanced?: (id: string, result: DriveResult) => void;
};

/**
 * 恢复扫描（`CONTEXT.md` 的「宿主」，ADR-0003）：重启之后，把该跑一次的跑一次、
 * 该补交的在飞**效果**补交给 **Performer**。
 *
 * 内核只回答「什么叫需要恢复」（`needsRecovery`）；「扫谁」来自宿主的 `WorkflowIndex`。
 * 逐个来：一份坏工作流不该拖垮整轮扫描，也不该让启动瞬间打出 N 个并发推进。
 */
export async function recover(
	host: Host,
	index: WorkflowIndex,
	options: RecoverOptions = {},
): Promise<RecoveryReport> {
	const report: RecoveryReport = {
		scanned: 0,
		advanced: [],
		quiescent: [],
		halted: [],
		missing: [],
		failed: [],
	};

	const ids = await index.ids();
	report.scanned = ids.length;

	for (const id of ids) {
		try {
			const loaded = await host.store.load(id);
			if (loaded === undefined) {
				report.missing.push(id);
				continue;
			}
			if (isHalted(loaded.snapshot)) {
				report.halted.push(id);
				continue;
			}
			const need = needsRecovery(loaded.snapshot);
			if (!need.run && !need.effects) {
				report.quiescent.push(id);
				continue;
			}
			// `drive` 先补交在飞效果、再推进；两件事都在那份工作流的串行入口里。
			const result = await drive(host, id);
			report.advanced.push({ id, result });
			options.onAdvanced?.(id, result);
		} catch (error) {
			report.failed.push({ id, error });
		}
	}

	return report;
}
