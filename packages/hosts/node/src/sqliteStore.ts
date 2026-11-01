import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import type { JsonValue } from "type-fest";
import {
	type CommitResult,
	type MatchSpec,
	type Snapshot,
	type SnapshotStore,
	type Subscription,
	WorkflowExists,
	WorkflowNotFound,
	snapshotSchema,
} from "@arbetslag/kernel";

/**
 * 一个文件装下 Node 宿主的全部持久状态（ADR-0015「存储位置」）：
 * - `snapshots`：一份工作流一行，整份 JSON（ADR-0003、0013）。没有版本列：并发控制是 `BEGIN IMMEDIATE` 的事。
 * - `subscriptions`：路由索引，触发器声明的投影；丢了可以从全部快照重建。
 * - `outbox`：路由发件箱。`(target, listener, event_id)` 唯一，按保留期清除、不按消费清除，所以它同时负责去重。
 * - `cursors`：每份工作流消费到发件箱的哪一行；与快照在同一次事务里推进。
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshots (
	id       TEXT PRIMARY KEY,
	snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
	workflow TEXT NOT NULL,
	trigger  TEXT NOT NULL,
	listener TEXT NOT NULL,
	kind     TEXT NOT NULL,
	config   TEXT NOT NULL,
	match    TEXT,
	grp      TEXT NOT NULL,
	priority INTEGER NOT NULL,
	PRIMARY KEY (workflow, trigger)
);
CREATE INDEX IF NOT EXISTS subscriptions_by_listener ON subscriptions (listener);
CREATE TABLE IF NOT EXISTS outbox (
	seq      INTEGER PRIMARY KEY AUTOINCREMENT,
	target   TEXT NOT NULL,
	trigger  TEXT NOT NULL,
	output   TEXT NOT NULL,
	body     TEXT NOT NULL,
	listener TEXT NOT NULL,
	event_id TEXT,
	at       INTEGER NOT NULL,
	UNIQUE (target, listener, event_id)
);
CREATE INDEX IF NOT EXISTS outbox_by_target ON outbox (target, seq);
CREATE TABLE IF NOT EXISTS cursors (
	workflow TEXT PRIMARY KEY,
	seq      INTEGER NOT NULL
);
`;

/** 路由索引的一行：内核的 `Subscription`，加上路由校验 body 需要的监听器、种类与触发器 config。 */
export type SubscriptionRow = Subscription & { listener: string; kind: string; config: JsonValue };

/** 路由发件箱里要写的一行。`eventId` 缺席就不去重（SQLite 里 NULL 互不相等）。 */
export type OutboxEntry = {
	target: string;
	trigger: string;
	output: string;
	body: JsonValue;
	listener: string;
	eventId?: string;
};

export type OutboxRow = OutboxEntry & { seq: number };

/**
 * 一次消费：拿到快照与游标之后的那些行，决定写回什么。
 * `consumed: false`（例如停住了）就不推进游标，行留在原地（ADR-0015）。
 */
export type DrainResult<T> = { snapshot?: Snapshot; consumed: boolean; value: T };

/** 另一个进程正持有这个文件（ADR-0014：一个文件一个进程）。 */
export class StoreLocked extends Error {
	readonly file: string;
	constructor(file: string) {
		super(`${file} is held by another process: one store file, one process (ADR-0014)`);
		this.name = "StoreLocked";
		this.file = file;
	}
}

export type SqliteStoreOptions = {
	/** 数据库文件路径；目录不存在就建。`:memory:` 给测试用。 */
	file: string;
	/**
	 * 打开时取得独占锁并一直持有（`locking_mode = EXCLUSIVE`），第二个进程打开同一个文件即失败（ADR-0014）。
	 * 默认开；只有验证存储自身并发语义的测试才关掉它。
	 */
	exclusive?: boolean;
	/** 不独占时，另一个连接正在写，先等这么久再报 `SQLITE_BUSY`。默认 5000ms。 */
	busyTimeoutMs?: number;
	/** 发件箱写入时间用的时钟（保留期按它算）。 */
	now?: () => number;
};

/**
 * Node 宿主的存储：`SnapshotStore`，同时是宿主的 `WorkflowIndex`（`ids()`）、路由索引与路由发件箱。
 *
 * 临界区由 SQLite 的写锁给：`BEGIN IMMEDIATE` 拿锁，回调在锁内同步跑完，`COMMIT` 放手（ADR-0013）。
 * 每个方法内部没有 `await`，所以同一进程里也不会在一次事务中间插进别的调用。
 */
export type SqliteStore = SnapshotStore & {
	/** 有序的全部 id：宿主的恢复扫描读它（不是内核的 `list()`）。 */
	ids(): Promise<string[]>;

	/** 对账：这份工作流在路由索引里的行换成 `rows`。 */
	replaceSubscriptions(workflow: string, rows: SubscriptionRow[]): Promise<void>;
	/** 一个监听器上的全部订阅（路由逐个跑，ADR-0015）。 */
	subscriptions(listener: string): Promise<SubscriptionRow[]>;
	/** 一次原子写：每个目标一行；同一 `(target, listener, eventId)` 已有就忽略。返回真正写进去的行数。 */
	enqueue(entries: OutboxEntry[]): Promise<number>;
	/**
	 * `workflow.spawn` 的那一次原子写（ADR-0015）：id 不存在就落快照并写它的索引行；再写转交的那一行。
	 * 索引行与转交行在同一次事务里，所以之后路由到它的事件一定排在被转交的那一行之后。
	 */
	spawn(id: string, snapshot: Snapshot, subscriptions: SubscriptionRow[], forward?: OutboxEntry): Promise<{ created: boolean }>;
	/** 一次存储事务：读游标之后的行与快照 → `apply` → 写回快照、推进游标。 */
	drain<T>(id: string, apply: (snapshot: Snapshot, rows: OutboxRow[]) => DrainResult<T>): Promise<T>;
	/** 发件箱里有比游标新的行的那些工作流（恢复扫描用）。 */
	pendingTargets(): Promise<string[]>;
	/** 清掉早于 `before`（毫秒时间戳）的发件箱行。返回删了几行。 */
	pruneOutbox(before: number): Promise<number>;

	/** 一份一致的副本到另一个文件（`backup()`：拷贝期间的写入不会撕裂它）。 */
	dumpTo(file: string): Promise<void>;
	/** 干净关闭：先 `wal_checkpoint(TRUNCATE)`，让库文件自己就是完整的一份；放开独占锁。可重复调用。 */
	close(): void;
};

/**
 * - **WAL + `synchronous = NORMAL`**：提交不 fsync，进程崩溃不丢，断电可能丢最后一次（ADR-0013）。
 * - **独占**：锁跟着连接走，进程崩溃时由操作系统释放，不留死锁文件（ADR-0014）。
 * - **读出来就校验**：库可能被 `sqlite3` 手改过或写坏了，让它响亮地坏掉，而不是推进一张破图。
 */
export function createSqliteStore(options: SqliteStoreOptions): SqliteStore {
	const { file } = options;
	const exclusive = options.exclusive ?? true;
	const busyTimeoutMs = Math.max(0, Math.trunc(options.busyTimeoutMs ?? 5000));
	const now = options.now ?? Date.now;
	if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

	const db = new DatabaseSync(file);
	if (exclusive) {
		// 不等：被别的进程持有就立刻失败，而不是排队等它退出。
		try {
			db.exec(`
				PRAGMA busy_timeout = 0;
				PRAGMA locking_mode = EXCLUSIVE;
				PRAGMA journal_mode = WAL;
				BEGIN EXCLUSIVE; COMMIT;
			`);
		} catch (error) {
			db.close();
			if ((error as { errcode?: number }).errcode === 5) throw new StoreLocked(file);
			throw error;
		}
	} else {
		db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = ${busyTimeoutMs};`);
	}
	db.exec("PRAGMA synchronous = NORMAL;");
	db.exec(SCHEMA);

	const selectById = db.prepare("SELECT snapshot FROM snapshots WHERE id = ?");
	const selectIds = db.prepare("SELECT id FROM snapshots ORDER BY id");
	// 已存在就什么都不改（`changes === 0` 就是冲突），不靠解析错误码。
	const insertNew = db.prepare("INSERT INTO snapshots (id, snapshot) VALUES (?, ?) ON CONFLICT (id) DO NOTHING");
	// 条件只有主键：进到这里时写锁已经在手上，没人能在这两条语句之间插进来。
	const updateById = db.prepare("UPDATE snapshots SET snapshot = ? WHERE id = ?");
	const deleteById = db.prepare("DELETE FROM snapshots WHERE id = ?");

	const deleteSubscriptions = db.prepare("DELETE FROM subscriptions WHERE workflow = ?");
	const insertSubscription = db.prepare(
		"INSERT INTO subscriptions (workflow, trigger, listener, kind, config, match, grp, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	);
	const selectSubscriptions = db.prepare(
		"SELECT workflow, trigger, listener, kind, config, match, grp, priority FROM subscriptions WHERE listener = ? ORDER BY workflow, trigger",
	);

	const insertOutbox = db.prepare(
		"INSERT INTO outbox (target, trigger, output, body, listener, event_id, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
	);
	const selectCursor = db.prepare("SELECT seq FROM cursors WHERE workflow = ?");
	const upsertCursor = db.prepare(
		"INSERT INTO cursors (workflow, seq) VALUES (?, ?) ON CONFLICT (workflow) DO UPDATE SET seq = excluded.seq",
	);
	const selectRows = db.prepare(
		"SELECT seq, target, trigger, output, body, listener, event_id FROM outbox WHERE target = ? AND seq > ? ORDER BY seq",
	);
	const selectPending = db.prepare(`
		SELECT DISTINCT o.target AS target FROM outbox o
		LEFT JOIN cursors c ON c.workflow = o.target
		WHERE o.seq > COALESCE(c.seq, 0)
		ORDER BY o.target
	`);
	const deleteOld = db.prepare("DELETE FROM outbox WHERE at < ?");
	const deleteCursor = db.prepare("DELETE FROM cursors WHERE workflow = ?");
	const deleteOutboxFor = db.prepare("DELETE FROM outbox WHERE target = ?");

	const parse = (row: Record<string, unknown>): Snapshot => {
		if (typeof row.snapshot !== "string") throw new Error("snapshot record has a broken shape");
		return snapshotSchema.parse(JSON.parse(row.snapshot));
	};

	/** 同步事务：回调里不许 `await`。 */
	function transaction<T>(work: () => T): T {
		db.exec("BEGIN IMMEDIATE");
		try {
			const result = work();
			db.exec("COMMIT");
			return result;
		} catch (error) {
			db.exec("ROLLBACK");
			throw error;
		}
	}

	function writeSubscriptions(workflow: string, rows: SubscriptionRow[]): void {
		deleteSubscriptions.run(workflow);
		for (const row of rows) {
			insertSubscription.run(
				workflow,
				row.trigger,
				row.listener,
				row.kind,
				JSON.stringify(row.config),
				row.match === undefined ? null : JSON.stringify(row.match),
				row.group,
				row.priority,
			);
		}
	}

	function writeOutbox(entry: OutboxEntry): boolean {
		const { changes } = insertOutbox.run(
			entry.target,
			entry.trigger,
			entry.output,
			JSON.stringify(entry.body),
			entry.listener,
			entry.eventId ?? null,
			now(),
		);
		return Number(changes) > 0;
	}

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
			return transaction(() => {
				const row = selectById.get(id);
				if (row === undefined) throw new WorkflowNotFound(id);
				const result = change(parse(row));
				if (result.snapshot !== undefined) updateById.run(JSON.stringify(result.snapshot), id);
				return result.value;
			});
		},

		async drop(id) {
			transaction(() => {
				deleteById.run(id);
				deleteSubscriptions.run(id);
				deleteCursor.run(id);
				deleteOutboxFor.run(id);
			});
		},

		async ids() {
			return selectIds.all().map((row) => String(row.id));
		},

		async replaceSubscriptions(workflow, rows) {
			transaction(() => writeSubscriptions(workflow, rows));
		},

		async subscriptions(listener) {
			return selectSubscriptions.all(listener).map((row) => ({
				workflowId: String(row.workflow),
				trigger: String(row.trigger),
				listener: String(row.listener),
				kind: String(row.kind),
				config: JSON.parse(String(row.config)) as JsonValue,
				...(row.match === null ? {} : { match: JSON.parse(String(row.match)) as MatchSpec }),
				group: String(row.grp),
				priority: Number(row.priority),
			}));
		},

		async enqueue(entries) {
			if (entries.length === 0) return 0;
			return transaction(() => entries.filter(writeOutbox).length);
		},

		async spawn(id, snapshot, subscriptions, forward) {
			return transaction(() => {
				const { changes } = insertNew.run(id, JSON.stringify(snapshot));
				const created = Number(changes) > 0;
				if (created) writeSubscriptions(id, subscriptions);
				if (forward !== undefined) writeOutbox(forward);
				return { created };
			});
		},

		async drain<T>(id: string, apply: (snapshot: Snapshot, rows: OutboxRow[]) => DrainResult<T>): Promise<T> {
			return transaction(() => {
				const row = selectById.get(id);
				if (row === undefined) throw new WorkflowNotFound(id);
				const cursor = Number(selectCursor.get(id)?.seq ?? 0);
				const rows: OutboxRow[] = selectRows.all(id, cursor).map((r) => ({
					seq: Number(r.seq),
					target: String(r.target),
					trigger: String(r.trigger),
					output: String(r.output),
					body: JSON.parse(String(r.body)) as JsonValue,
					listener: String(r.listener),
					...(r.event_id === null ? {} : { eventId: String(r.event_id) }),
				}));
				const result = apply(parse(row), rows);
				if (result.snapshot !== undefined) updateById.run(JSON.stringify(result.snapshot), id);
				const last = rows.at(-1);
				if (result.consumed && last !== undefined) upsertCursor.run(id, last.seq);
				return result.value;
			});
		},

		async pendingTargets() {
			return selectPending.all().map((row) => String(row.target));
		},

		async pruneOutbox(before) {
			const { changes } = deleteOld.run(before);
			return Number(changes);
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
