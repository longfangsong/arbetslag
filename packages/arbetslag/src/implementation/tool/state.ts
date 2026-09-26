import { FileSystem } from "@/application/file/model";
import type { ToolStateRepository } from "@/application/tool/state";
import createDebug from "debug";

const log = createDebug("arbetslag:tool");

/**
 * One JSON file per key under `tool_state/`, with an instance cache so
 * repeated reads inside a run don't hit the file system.
 */
export class FileSystemToolStateRepository implements ToolStateRepository {
	private readonly cache = new Map<string, unknown>();
	private readonly dir: string;

	constructor(
		private fs: FileSystem,
		dir: string = "tool_state/",
	) {
		this.dir = dir.endsWith("/") ? dir : `${dir}/`;
	}

	async get<T>(key: string): Promise<T | null> {
		if (this.cache.has(key)) return this.cache.get(key) as T;
		let content: string;
		try {
			content = await this.fs.readFile(`${this.dir}${key}.json`);
		} catch {
			return null; // no state persisted for this key yet
		}
		try {
			return JSON.parse(content) as T;
		} catch (error) {
			log(`❌ tool state ${key}: stored value is not JSON: ${error}`);
			return null;
		}
	}

	async set<T>(key: string, value: T): Promise<void> {
		this.cache.set(key, value);
		await this.fs.writeFile(`${this.dir}${key}.json`, JSON.stringify(value));
	}
}
