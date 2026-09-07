import fs from "node:fs/promises";
import nodePath from "node:path";
import { FileSystem } from "@/application/file/model";

export class NodeFileSystem implements FileSystem {
	constructor(private readonly baseDir: string = ".") {}

	private resolve(p: string): string {
		return nodePath.isAbsolute(p) ? p : nodePath.join(this.baseDir, p);
	}

	async readFile(
		path: string,
		offset?: number,
		length?: number,
	): Promise<string> {
		let content = await fs.readFile(this.resolve(path), "utf-8");
		if (offset !== undefined && length !== undefined) {
			return content.slice(offset, offset + length);
		}
		if (offset !== undefined) {
			return content.slice(offset);
		}
		if (length !== undefined) {
			return content.slice(0, length);
		}
		return content;
	}

	async writeFile(path: string, content: string): Promise<void> {
		const resolved = this.resolve(path);
		await fs.mkdir(nodePath.dirname(resolved), { recursive: true });
		await fs.writeFile(resolved, content, "utf-8");
	}

	async editFile(
		path: string,
		content: string,
		offset: number,
		length: number,
	): Promise<void> {
		const resolved = this.resolve(path);
		const existing = await fs.readFile(resolved, "utf-8");
		const updated =
			existing.slice(0, offset) + content + existing.slice(offset + length);
		await fs.writeFile(resolved, updated, "utf-8");
	}

	async listFiles(directory: string): Promise<string[]> {
		const resolved = this.resolve(directory);
		const entries = await fs.readdir(resolved, { withFileTypes: true });
		return entries
			.filter((e) => e.isFile())
			.map((e) => nodePath.join(resolved, e.name));
	}

	async deleteFile(path: string): Promise<void> {
		await fs.unlink(this.resolve(path));
	}
}
