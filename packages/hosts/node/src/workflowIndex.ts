/**
 * 宿主自己维护的「有哪些工作流」（`CONTEXT.md` 的「宿主」）。
 *
 * 它只回答恢复扫描要看哪些 id，不是事实来源、不在 `SnapshotStore` 里（ADR-0003 拒绝 `Store.list()`）：
 * 一份工作流住在 Durable Object 里时，它永远列不出「全库谁有 pending」。
 *
 * 所以它没有构造器工厂式的实现，只有「我这个部署能不能全列」的两份答案：
 * - Node + 单文件存储：`SqliteStore` 自己就满足这个接口（多一个 `ids()`，结构化类型直接对得上），
 *   索引就是一条 `SELECT id`（ADR-0013）——不需要适配器，也不需要第二份账。
 * - 别人的部署：调用方给 FK 一个实现；内存那份在下面，给测试和 demo 用。
 */
export interface WorkflowIndex {
	ids(): Promise<string[]>;
}

/**
 * 内存实现：给测试与内存 demo 用。传进来的数组由调用方维护，`ids()` 每次重新读它。
 * 它不替 `SnapshotStore` 记账——工作流删掉了索引里还在，恢复扫描会看到「记录不存在」。
 */
export function createMemoryIndex(ids: string[] = []): WorkflowIndex {
	return { ids: async () => [...ids] };
}
