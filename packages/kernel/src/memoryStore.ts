import { WorkflowExists, WorkflowNotFound } from "./errors.ts";
import type { SnapshotStore } from "./snapshotStore.ts";
import type { Snapshot } from "./workflow/snapshot.ts";

/**
 * 进程内的 `SnapshotStore`：给测试和示例用。读写都深拷贝，
 * 保证调用方拿到的和存进去的互不相干（快照是纯 JSON）。
 *
 * 临界区在这里是免费的：JS 单线程，`commit` 里不会有第二个 `commit` 插进来（ADR-0013）。
 */
export function createMemoryStore(): SnapshotStore {
	const records = new Map<string, Snapshot>();
	const clone = (snapshot: Snapshot): Snapshot => structuredClone(snapshot);

	return {
		async load(id) {
			const snapshot = records.get(id);
			return snapshot === undefined ? undefined : clone(snapshot);
		},

		async create(id, snapshot) {
			if (records.has(id)) throw new WorkflowExists(id);
			records.set(id, clone(snapshot));
		},

		async commit(id, change) {
			const current = records.get(id);
			if (current === undefined) throw new WorkflowNotFound(id);
			// 给 change 一份拷贝：它改坏了又决定不写，存着的那份不受影响。
			const result = change(clone(current));
			if (result.snapshot !== undefined) records.set(id, clone(result.snapshot));
			return result.value;
		},

		async drop(id) {
			records.delete(id);
		},
	};
}
