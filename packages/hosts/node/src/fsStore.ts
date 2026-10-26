import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type Revision,
	type Snapshot,
	type SnapshotStore,
	Conflict,
	snapshotSchema,
} from "@arbetslag/kernel";
import { createKeyedQueue } from "./queue.ts";

const RECORD_SUFFIX = ".json";

/**
 * 一份快照的文件名。id 不透明，可能含 `/`、`:`、空格，所以按 base64url 编码，
 * 不猜它的形状（ADR-0003：内核不解析 id）。
 */
export function snapshotFile(dir: string, id: string): string {
	return join(dir, `${Buffer.from(id, "utf8").toString("base64url")}${RECORD_SUFFIX}`);
}

/** 文件名 → id；不是快照文件（临时文件、别人放的东西）返回 `undefined`。 */
export function workflowIdOf(fileName: string): string | undefined {
	if (!fileName.endsWith(RECORD_SUFFIX)) return undefined;
	const encoded = fileName.slice(0, -RECORD_SUFFIX.length);
	if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;
	return Buffer.from(encoded, "base64url").toString("utf8");
}

/** 只认 errno 里的 `code`：目录不存在、文件不存在都是正常情况，别的错误照抛。 */
export function isErrno(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

/** 盘上的一条记录：快照 + 版本。版本是 CAS 令牌，放进同一个文件，免得两个文件对不上。 */
type Record = { revision: Revision; snapshot: Snapshot };

async function readRecord(path: string): Promise<Record | undefined> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isErrno(error, "ENOENT")) return undefined;
		throw error;
	}
	const parsed = JSON.parse(text) as { revision?: unknown; snapshot?: unknown };
	if (typeof parsed.revision !== "string") throw new Error(`snapshot record ${path} has no revision`);
	// 盘上的东西可能被手改过或写坏了：读出来就校验，让它响亮地坏掉，而不是推进一张破图。
	return { revision: parsed.revision, snapshot: snapshotSchema.parse(parsed.snapshot) };
}

export type FsStoreOptions = { dir: string };

/**
 * Node 宿主的 `SnapshotStore`：一条记录一个文件。
 *
 * - 写是「写临时文件 + 同目录 rename」，读者只会看到旧的或新的那一份。
 * - 版本校验读-比-写不是原子的，靠的是**同一 id 的写在这里串行**（进程内），
 *   跨进程靠 rename 的原子性和 `Conflict` 让调用方重来（ADR-0003）。
 * - 不做 fsync：断电可能丢最后一次写，快照本来就是「没落盘的推进等于没发生」。
 */
export function createFsStore(options: FsStoreOptions): SnapshotStore {
	const { dir } = options;
	const writes = createKeyedQueue();

	async function write(path: string, record: Record): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const temp = `${path}.${randomUUID()}.tmp`;
		await writeFile(temp, JSON.stringify(record), "utf8");
		await rename(temp, path);
	}

	return {
		async load(id) {
			const record = await readRecord(snapshotFile(dir, id));
			if (record === undefined) return undefined;
			return { snapshot: record.snapshot, revision: record.revision };
		},

		save(id, snapshot, expected) {
			return writes.add(id, async () => {
				const path = snapshotFile(dir, id);
				const current = await readRecord(path);
				if (expected === null) {
					if (current !== undefined) throw new Conflict(id, "exists");
				} else if (current === undefined) {
					throw new Conflict(id, "missing");
				} else if (current.revision !== expected) {
					throw new Conflict(id, "stale");
				}
				const revision = randomUUID();
				await write(path, { revision, snapshot });
				return revision;
			});
		},

		async drop(id) {
			await writes.add(id, async () => {
				try {
					await unlink(snapshotFile(dir, id));
				} catch (error) {
					if (!isErrno(error, "ENOENT")) throw error;
				}
			});
		},
	};
}
