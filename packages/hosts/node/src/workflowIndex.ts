import { readdir } from "node:fs/promises";
import { type FsStoreOptions, isErrno, workflowIdOf } from "./fsStore.ts";

/**
 * 宿主自己维护的「有哪些工作流」（`CONTEXT.md` 的「宿主」）。
 *
 * 它只回答恢复扫描要看哪些 id，不是事实来源、不在 `SnapshotStore` 里（ADR-0003 拒绝 `Store.list()`）：
 * 一份工作流住在 Durable Object 里时，它永远列不出「全库谁有 pending」。
 */
export interface WorkflowIndex {
	ids(): Promise<string[]>;
}

/** Node 上的索引就是扫目录，和 `createFsStore` 用同一套文件名。 */
export function createFsIndex(options: FsStoreOptions): WorkflowIndex {
	return {
		async ids() {
			let names: string[];
			try {
				names = await readdir(options.dir);
			} catch (error) {
				if (isErrno(error, "ENOENT")) return [];
				throw error;
			}
			const ids: string[] = [];
			for (const name of names) {
				const id = workflowIdOf(name);
				if (id !== undefined) ids.push(id);
			}
			return ids.sort();
		},
	};
}

/**
 * 内存实现：给测试与内存 demo 用。传进来的数组由调用方维护，`ids()` 每次重新读它。
 * 它不替 `SnapshotStore` 记账——工作流删掉了索引里还在，恢复扫描会看到「记录不存在」。
 */
export function createMemoryIndex(ids: string[] = []): WorkflowIndex {
	return { ids: async () => [...ids] };
}
