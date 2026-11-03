import type { LogEntry, TransitionLog } from "../store/log.ts";

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
