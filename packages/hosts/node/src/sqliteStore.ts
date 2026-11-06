import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import type { Store } from "@arbetslag/kernel";
import type { JsonValue } from "type-fest";

/**
 * 用一个 SQLite 文件承载全部 key-value 状态（node:sqlite 内置实现）。
 * - 传 ":memory:" 得到内存库，适合测试。
 * - get 在 key 不存在时抛错：调用方应先 set 或自行处理首次运行。
 */
export class SqliteStore implements Store {
    #db: DatabaseSync;

    constructor(file: string) {
        mkdirSync(dirname(file), { recursive: true });
        this.#db = new DatabaseSync(file);
        this.#db.exec("PRAGMA journal_mode = WAL;");
        this.#db.exec(`
            CREATE TABLE IF NOT EXISTS kv (
                id    TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }

    async get<T extends JsonValue>(id: string): Promise<T> {
        const row = this.#db
            .prepare("SELECT value FROM kv WHERE id = ?")
            .get(id) as { value: string } | undefined;
        if (row === undefined) {
            throw new Error(`key not found in store: ${id}`);
        }
        return JSON.parse(row.value) as T;
    }

    async set<T extends JsonValue>(id: string, value: T): Promise<void> {
        this.#db
            .prepare(
                "INSERT INTO kv (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value"
            )
            .run(id, JSON.stringify(value));
    }

    close(): void {
        this.#db.close();
    }
}
