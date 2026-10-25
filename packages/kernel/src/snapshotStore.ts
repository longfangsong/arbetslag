import type { Snapshot } from "./workflow/snapshot.ts";

/**
 * 并发控制令牌：每次成功写入后由 Store 换一个新值，内核只比较是否相等、从不解释。
 * 不叫 version，免得和节点定义的版本（ADR-0004）混淆。
 */
export type Revision = string;

export type StoredSnapshot = {
	snapshot: Snapshot;
	revision: Revision;
};

/**
 * 一份工作流的快照记录（ADR-0003）。id 等于 store 的 key，不透明。
 * 没有 `list()`：全库有哪些工作流需要恢复，归宿主自己的索引（ADR-0003）。
 */
export interface SnapshotStore {
	/** 没有这条记录返回 `undefined`。 */
	load(id: string): Promise<StoredSnapshot | undefined>;

	/**
	 * 带版本写回：`expected` 为 `null` 表示创建（id 已存在即冲突，不提供"已存在就复用"的开关）；
	 * 否则必须等于当前 revision。不符抛 `Conflict`。成功返回新的 revision。
	 */
	save(id: string, snapshot: Snapshot, expected: Revision | null): Promise<Revision>;

	/** 整体删除，不留墓碑；记录不存在也不报错。 */
	drop(id: string): Promise<void>;
}

/** CAS 失败：调用方（deliver / run）重载重来，超过次数再抛给上层（ADR-0003）。 */
export class Conflict extends Error {
	readonly id: string;
	/**
	 * - `exists`：想创建但 id 已存在
	 * - `missing`：想更新但记录不在了（被 drop）
	 * - `stale`：记录在，但 revision 不是期望的那个
	 */
	readonly reason: "exists" | "missing" | "stale";

	constructor(id: string, reason: Conflict["reason"]) {
		super(`conflict on workflow ${JSON.stringify(id)}: ${reason}`);
		this.name = "Conflict";
		this.id = id;
		this.reason = reason;
	}
}
