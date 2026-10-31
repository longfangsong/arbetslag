import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import {
	type CommitResult,
	type Snapshot,
	type SnapshotStore,
	WorkflowExists,
	WorkflowNotFound,
	snapshotSchema,
} from "@arbetslag/kernel";

/**
 * 一份工作流 = `snapshots` 里的一行：`id` 主键，`snapshot` 一整份 JSON。
 * 不拆表——跨记录事务解决的是不存在的多写者问题，而拆表会赔掉「整份快照可 dump / diff / 断言」（ADR-0013）。
 * 没有版本列：并发控制是 `BEGIN IMMEDIATE` 的事，不是内核的概念。
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
	id       TEXT PRIMARY KEY,
	snapshot TEXT NOT NULL
);
`;

export type SqliteStoreOptions = {
	/** 数据库文件路径；目录不存在就建。 */
	file: string;
	/** 另一个连接（可能是别的进程）正在写时，先等这么久再报 `SQLITE_BUSY`。默认 5000ms。 */
	busyTimeoutMs?: number;
};

/**
 * Node 宿主的 `SnapshotStore`，同时就是宿主的 `WorkflowIndex`（多一个 `ids()`，结构化类型直接对得上）。
 *
 * 临界区由 SQLite 的写锁给：`BEGIN IMMEDIATE` 拿锁，`commit` 的回调在锁内同步跑完，`COMMIT` 放手。
 * **同一个 id 的两次推进不可能交错**——后到的在 `BEGIN` 处等，进去之后读到的就是前一个写下的（ADR-0013）。
 */
export type SqliteStore = SnapshotStore & {
	/** 有序的全部 id：宿主的恢复扫描读它（ADR-0003 的 `WorkflowIndex`，不是内核的 `list()`）。 */
	ids(): Promise<string[]>;
	/** 一份一致的副本到另一个文件（`backup()`：拷贝期间的写入不会撕裂它）。 */
	dumpTo(file: string): Promise<void>;
	/** 干净关闭：先 `wal_checkpoint(TRUNCATE)`，让库文件自己就是完整的一份。可重复调用。 */
	close(): void;
};

/**
 * - **WAL + `synchronous = NORMAL`**：提交不 fsync，进程崩溃不丢，断电可能丢最后一次（ADR-0013）。
 * - **`busy_timeout`**：跨进程撞上写锁就等。它必须大于最慢的一次 `commit` 回调，否则会是假超时。
 * - **读出来就校验**：库可能被 `sqlite3` 手改过或写坏了，让它响亮地坏掉，而不是推进一张破图。
 */
export function createSqliteStore(options: SqliteStoreOptions): SqliteStore {
	const { file } = options;
	const busyTimeoutMs = Math.max(0, Math.trunc(options.busyTimeoutMs ?? 5000));
	mkdirSync(dirname(file), { recursive: true });

	const db = new DatabaseSync(file);
	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		PRAGMA busy_timeout = ${busyTimeoutMs};
	`);
	db.exec(SCHEMA);

	const selectById = db.prepare("SELECT snapshot FROM snapshots WHERE id = ?");
	const selectIds = db.prepare("SELECT id FROM snapshots ORDER BY id");
	// 已存在就什么都不改（`changes === 0` 就是冲突），不靠解析错误码。
	const insertNew = db.prepare("INSERT INTO snapshots (id, snapshot) VALUES (?, ?) ON CONFLICT (id) DO NOTHING");
	// 条件只有主键：进到这里时写锁已经在手上，没人能在这两条语句之间插进来。
	const updateById = db.prepare("UPDATE snapshots SET snapshot = ? WHERE id = ?");
	const deleteById = db.prepare("DELETE FROM snapshots WHERE id = ?");

	const parse = (row: Record<string, unknown>): Snapshot => {
		if (typeof row.snapshot !== "string") throw new Error("snapshot record has a broken shape");
		return snapshotSchema.parse(JSON.parse(row.snapshot));
	};

	let closed = false;

	return {
		async load(id) {
			const row = selectById.get(id);
			return row === undefined ? undefined : parse(row);
		},

		async create(id, snapshot) {
			const { changes } = insertNew.run(id, JSON.stringify(snapshot));
			if (Number(changes) === 0) throw new WorkflowExists(id);
		},

		async commit<T>(id: string, change: (snapshot: Snapshot) => CommitResult<T>): Promise<T> {
			db.exec("BEGIN IMMEDIATE");
			try {
				const row = selectById.get(id);
				if (row === undefined) throw new WorkflowNotFound(id);
				const result = change(parse(row));
				if (result.snapshot !== undefined) updateById.run(JSON.stringify(result.snapshot), id);
				db.exec("COMMIT");
				return result.value;
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},

		async drop(id) {
			deleteById.run(id);
		},

		async ids() {
			return selectIds.all().map((row) => String(row.id));
		},

		async dumpTo(target) {
			mkdirSync(dirname(target), { recursive: true });
			// `backup()` 不会清掉目标里已有的页，所以先把它删干净；不然「导到旧文件上」是错的。
			rmSync(target, { force: true });
			await backup(db, target);
		},

		close() {
			if (closed) return;
			closed = true;
			// 截断 WAL：这样干净退出之后「一份数据」就是一个文件，而不是 db + -wal。
			db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			db.close();
		},
	};
}
