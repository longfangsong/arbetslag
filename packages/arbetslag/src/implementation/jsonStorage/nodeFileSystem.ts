import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsonValue } from "type-fest";
import type { JsonStorage } from "../../domain/jsonStorage";
import { nanoid } from "../../utils";

/**
 * A {@link JsonStorage} backed by the local file system.
 *
 * Each key maps to a single JSON file under a base directory: path
 * separators in the key correspond to nested folders (key `agents/abc` stores
 * `<baseDir>/agents/abc.json`). Keys that would resolve outside the base
 * directory are rejected.
 */
export class NodeFileSystemStorage implements JsonStorage {
  constructor(
    /** Directory that all stored files live under (created on demand). */
    public readonly baseDir: string,
  ) {
    // Workers expose `WorkerGlobalScope`; Node does not. Catch accidental use
    // of this Node-only storage in Workers early, where a filesystem would
    // silently be a per-request in-memory VFS (no persistence).
    if (
      typeof (
        globalThis as Record<string, unknown>
      ).WorkerGlobalScope !== "undefined"
    ) {
      throw new Error(
        "NodeFileSystemStorage requires the Node.js file system and cannot be used in Cloudflare Workers; use a KV/R2-backed JsonStorage instead.",
      );
    }
  }

  async get(key: string): Promise<JsonValue | undefined> {
    try {
      const raw = await readFile(this.fileFor(key), "utf8");
      return JSON.parse(raw) as JsonValue;
    } catch (error) {
      if (isEnoent(error)) return undefined;
      throw error;
    }
  }

  async set(key: string, value: JsonValue): Promise<void> {
    const file = this.fileFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    // Write to a temp file in the same directory, then rename, so readers
    // never observe a partially written file (rename is atomic on POSIX).
    const tmp = `${file}.${nanoid()}.tmp`;
    await writeFile(tmp, JSON.stringify(value), "utf8");
    await rename(tmp, file);
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.fileFor(key));
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }

  /** Resolve a storage key to a file path inside the base directory. */
  private fileFor(key: string): string {
    if (key.length === 0 || key.includes("\u0000")) {
      throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    }
    const file = path.resolve(this.baseDir, `${key}.json`);
    if (!file.startsWith(`${path.resolve(this.baseDir)}${path.sep}`)) {
      throw new Error(`Storage key escapes the base directory: ${key}`);
    }
    return file;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
