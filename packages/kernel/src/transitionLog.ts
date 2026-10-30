import type { HaltCode } from "./halt.ts";

/**
 * 转移日志的条目（ADR-0003）：旁路、只追加、不进快照、不参与 CAS，
 * 可丢、可截断，从来不是事实来源。
 */
export type LogEntry = { at: string } & (
	/** `sends` 是 send 的条数，`delivered` 是实际投出的消息数：沿边发时等于订阅者个数（ADR-0011）。 */
	| { type: "transition"; node: string; messageType: string; seq: number; sends: number; delivered: number; effects: number }
	/** 发出的消息没有去处：端口没接线，或显式目标不存在（ADR-0002）。`from` 可以是触发器。 */
	| { type: "dropped"; from: string; port: string; reason: "no_edge" | "no_target" }
	| { type: "migrated"; node: string; from: number; to: number }
	| { type: "halted"; code: HaltCode; node?: string; detail: string }
);

/** 日志写失败不影响工作流：调用方会吞掉异常。 */
export interface TransitionLog {
	append(workflowId: string, entries: LogEntry[]): void | Promise<void>;
}

/** 进程内的日志，给测试用：`entries` 按写入顺序。 */
export function createMemoryLog(): TransitionLog & { entries: Map<string, LogEntry[]> } {
	const entries = new Map<string, LogEntry[]>();
	return {
		entries,
		append(workflowId, batch) {
			entries.set(workflowId, [...(entries.get(workflowId) ?? []), ...batch]);
		},
	};
}

/** 尽力而为：日志是旁路，写不进去也不能让推进失败。 */
export async function appendLog(
	log: TransitionLog | undefined,
	workflowId: string,
	entries: LogEntry[],
): Promise<void> {
	if (log === undefined || entries.length === 0) return;
	try {
		await log.append(workflowId, entries);
	} catch {
		// 旁路：吞掉
	}
}
