import { Conflict, type Revision, type SnapshotStore, type StoredSnapshot } from "./snapshotStore.ts";
import type { Snapshot } from "./workflow/snapshot.ts";

/**
 * 进程内的 `SnapshotStore`：给测试和示例用。读写都深拷贝，
 * 保证调用方拿到的和存进去的互不相干（快照是纯 JSON）。
 */
export function createMemoryStore(): SnapshotStore {
	const records = new Map<string, { snapshot: Snapshot; counter: number }>();

	const clone = (snapshot: Snapshot): Snapshot => structuredClone(snapshot);

	return {
		async load(id): Promise<StoredSnapshot | undefined> {
			const record = records.get(id);
			if (record === undefined) return undefined;
			return { snapshot: clone(record.snapshot), revision: String(record.counter) };
		},

		async save(id, snapshot, expected): Promise<Revision> {
			const current = records.get(id);
			if (expected === null) {
				if (current !== undefined) throw new Conflict(id, "exists");
			} else if (current === undefined) {
				throw new Conflict(id, "missing");
			} else if (String(current.counter) !== expected) {
				throw new Conflict(id, "stale");
			}
			const counter = (current?.counter ?? 0) + 1;
			records.set(id, { snapshot: clone(snapshot), counter });
			return String(counter);
		},

		async drop(id): Promise<void> {
			records.delete(id);
		},
	};
}
