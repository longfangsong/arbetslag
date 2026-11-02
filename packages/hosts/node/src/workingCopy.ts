import { type Snapshot, type SnapshotStore, WorkflowNotFound } from "@arbetslag/kernel";
import { type OutboxRow, type SqliteStore, type SubscriptionRow, subscriptionsOf } from "./sqliteStore.ts";

/** 一次消费：拿到快照与游标之后的那些行，决定改成什么。`consumed: false`（例如停住了）就不动游标。 */
export type DrainResult<T> = { snapshot?: Snapshot; consumed: boolean; value: T };

/**
 * 激活的工作副本（ADR-0016）：给内核的 `SnapshotStore`，`commit` 只改内存，
 * 检查点才把它写进存储——一次事务写完快照、发件箱游标、（触发器变了时）路由索引。
 *
 * 只有脏的工作流在这里：写完检查点就丢掉，下次从存储重新读。所以干净的工作流不常驻，
 * 激活之外对存储的改动（运维手改、测试）在它干净时也看得见。
 * 同一个 id 的调用由宿主的串行入口排好，这里不再加锁。
 */
export type WorkingCopies = SnapshotStore & {
	/** 发件箱 → 邮箱：游标（工作副本里的优先）之后的行交给 `apply`；游标在工作副本里前进。 */
	drain<T>(id: string, apply: (snapshot: Snapshot, rows: OutboxRow[]) => DrainResult<T>): Promise<T>;
	/**
	 * 写检查点并丢掉工作副本；不脏就什么都不做。
	 * 触发器变了时带回写进路由索引的那些行，宿主据此重算未就绪。
	 */
	checkpoint(id: string): Promise<{ written: boolean; subscriptions?: SubscriptionRow[] }>;
};

type Entry = {
	snapshot: Snapshot;
	/** 还没落盘的游标。 */
	cursor?: number;
	/** 上一个检查点里的触发器：变了才重写路由索引。 */
	triggers: string;
};

const triggersOf = (snapshot: Snapshot): string => JSON.stringify(snapshot.graph.shape.triggers);

export function createWorkingCopies(store: SqliteStore): WorkingCopies {
	const entries = new Map<string, Entry>();

	/**
	 * 给变换用的底稿：工作副本的一份拷贝（变换可能改坏了又不写），或者刚从存储读出来的那份；
	 * 连同变换之前的触发器基线。
	 */
	async function base(id: string): Promise<{ snapshot: Snapshot; entry?: Entry; triggers: string }> {
		const entry = entries.get(id);
		if (entry !== undefined) return { snapshot: structuredClone(entry.snapshot), entry, triggers: entry.triggers };
		const loaded = await store.load(id);
		if (loaded === undefined) throw new WorkflowNotFound(id);
		return { snapshot: loaded, triggers: triggersOf(loaded) };
	}

	function keep(id: string, triggers: string, snapshot: Snapshot, cursor: number | undefined): void {
		entries.set(id, { snapshot, ...(cursor === undefined ? {} : { cursor }), triggers });
	}

	return {
		async load(id) {
			const entry = entries.get(id);
			return entry === undefined ? store.load(id) : structuredClone(entry.snapshot);
		},

		create: (id, snapshot) => store.create(id, snapshot),

		async commit(id, change) {
			const { snapshot, entry, triggers } = await base(id);
			const result = change(snapshot);
			if (result.snapshot !== undefined) keep(id, triggers, result.snapshot, entry?.cursor);
			return result.value;
		},

		async drop(id) {
			entries.delete(id);
			await store.drop(id);
		},

		async drain(id, apply) {
			const { snapshot, entry, triggers } = await base(id);
			const rows = await store.outboxAfter(id, entry?.cursor ?? (await store.cursor(id)));
			const result = apply(snapshot, rows);
			const last = rows.at(-1);
			const cursor = result.consumed && last !== undefined ? last.seq : undefined;
			if (result.snapshot !== undefined || cursor !== undefined) {
				keep(id, triggers, result.snapshot ?? snapshot, cursor ?? entry?.cursor);
			}
			return result.value;
		},

		async checkpoint(id) {
			const entry = entries.get(id);
			if (entry === undefined) return { written: false };
			const subscriptions =
				triggersOf(entry.snapshot) === entry.triggers ? undefined : subscriptionsOf(id, entry.snapshot);
			try {
				await store.checkpoint(id, {
					snapshot: entry.snapshot,
					...(entry.cursor === undefined ? {} : { cursor: entry.cursor }),
					...(subscriptions === undefined ? {} : { subscriptions }),
				});
			} catch (error) {
				// 等待期间被删了：工作副本没有去处。别的失败（磁盘）留着它，下一个检查点再试。
				if (error instanceof WorkflowNotFound) entries.delete(id);
				throw error;
			}
			entries.delete(id);
			return subscriptions === undefined ? { written: true } : { written: true, subscriptions };
		},
	};
}
