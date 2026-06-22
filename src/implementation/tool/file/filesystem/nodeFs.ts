import fs from "node:fs/promises";
import path from "node:path";
import { FileSystem } from "@/application/file/model";

export class NodeFileSystem implements FileSystem {
	async readFile(
		path: string,
		offset?: number,
		length?: number,
	): Promise<string> {
		let content = await fs.readFile(path, "utf-8");
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
		await fs.writeFile(path, content, "utf-8");
	}

	async editFile(
		path: string,
		content: string,
		offset: number,
		length: number,
	): Promise<void> {
		const existing = await fs.readFile(path, "utf-8");
		const updated =
			existing.slice(0, offset) + content + existing.slice(offset + length);
		await fs.writeFile(path, updated, "utf-8");
	}

	async listFiles(directory: string): Promise<string[]> {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		return entries
			.filter((e) => e.isFile())
			.map((e) => path.join(directory, e.name));
	}

	async deleteFile(path: string): Promise<void> {
		await fs.unlink(path);
	}
}
