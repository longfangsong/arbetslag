import { WorkflowNotFound } from "../errors.ts";
import type { Snapshot } from "../workflow/snapshot.ts";
import { Conflict, type SnapshotStore } from "../snapshotStore.ts";

/** CAS 冲突后重载重来的次数上限（ADR-0003）。 */
export const MAX_ATTEMPTS = 3;

/**
 * 载入 → 改 → 带版本写回；冲突就整段丢掉重来，超过次数抛 `Conflict`。
 * `change` 返回 `undefined` 表示没有改动，不写；它抛的错原样传给调用方。
 * `change` 必须是纯的（可能被调用多次），入参快照是它自己的拷贝。
 */
export async function update<T>(
	store: SnapshotStore,
	id: string,
	change: (snapshot: Snapshot) => { snapshot: Snapshot; value: T } | { snapshot?: undefined; value: T },
): Promise<T> {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const loaded = await store.load(id);
		if (loaded === undefined) throw new WorkflowNotFound(id);
		const result = change(loaded.snapshot);
		if (result.snapshot === undefined) return result.value;
		try {
			await store.save(id, result.snapshot, loaded.revision);
			return result.value;
		} catch (error) {
			if (error instanceof Conflict && error.reason === "stale") continue;
			throw error;
		}
	}
	throw new Conflict(id, "stale");
}
