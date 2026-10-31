import type { Snapshot } from "./workflow/snapshot.ts";

/**
 * 一次变换的结果：写回一份新快照，或者什么都不写（只取值）。
 * `snapshot` 缺席 = 这次没有改动，存储不必落盘（ADR-0003：有改动才写）。
 */
export type CommitResult<T> = { snapshot: Snapshot; value: T } | { snapshot?: undefined; value: T };

/**
 * 一份工作流的快照记录（ADR-0003）。id 等于 store 的 key，不透明。
 * 没有 `list()`：全库有哪些工作流需要恢复，归宿主自己的索引（ADR-0003）。
 *
 * **没有版本号，也没有「带版本的写」。** 并发控制是存储的事，不是内核的概念：
 * `commit` 把「读快照 → 变换 → 写回」整段放进存储自己的临界区（ADR-0013）。
 */
export interface SnapshotStore {
	/** 没有这条记录返回 `undefined`。 */
	load(id: string): Promise<Snapshot | undefined>;

	/**
	 * 创建：id 已存在抛 `WorkflowExists`。不提供"已存在就复用"——幂等由调用方 `load` 后自己表达。
	 */
	create(id: string, snapshot: Snapshot): Promise<void>;

	/**
	 * 在存储的临界区里跑一次变换，整段原子：读快照 → `change` → 写回。
	 *
	 * - `change` **必须同步**（返回的不是 promise）：临界区绝不许横跨外部调用或 `await`，
	 *   否则就是在锁里等网络。它必须是纯的——把并发做在实现内部的存储可以重试它（ADR-0013）。
	 * - 记录不存在抛 `WorkflowNotFound`；也可以什么都不写，返回 `{ value }`。
	 * - 同一个 id 的两次 `commit` 不会交错：后到的在临界区外等，进去之后读到的就是前一个写下的。
	 */
	commit<T>(id: string, change: (snapshot: Snapshot) => CommitResult<T>): Promise<T>;

	/** 整体删除，不留墓碑；记录不存在也不报错。 */
	drop(id: string): Promise<void>;
}
