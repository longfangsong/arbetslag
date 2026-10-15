import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "../../abstraction/store";

/**
 * Store backed by one file per key in a directory.
 *
 * Keys are percent-encoded so that any key maps to a single, filesystem-safe
 * file name. Missing keys read as `undefined`.
 */
export class NodeFsStore implements Store {
    private readonly directory: string;

    constructor(directory: string) {
        this.directory = directory;
    }

    /**
     * Map a key to its file, encoding '.' too so ".." cannot escape the
     * directory. Empty keys are rejected because they would name the directory
     * itself rather than a file.
     */
    private filePath(key: string): string {
        if (key === "") {
            throw new Error("NodeFsStore: key must not be empty");
        }
        return join(this.directory, encodeURIComponent(key).replaceAll(".", "%2E"));
    }

    async set(key: string, value: string): Promise<void> {
        await mkdir(this.directory, { recursive: true });
        await writeFile(this.filePath(key), value, "utf8");
    }

    async get(key: string): Promise<string | undefined> {
        try {
            return await readFile(this.filePath(key), "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
    }
}
