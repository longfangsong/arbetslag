import { FileSystem } from "@/domain/filesystem/model";

export class InMemoryFileSystem implements FileSystem {
	private files: Map<string, string> = new Map();

	async readFile(
		path: string,
		offset?: number,
		length?: number,
	): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) {
			throw new Error(`File not found: ${path}`);
		}
		if (offset !== undefined && length !== undefined) {
			return content.slice(offset, offset + length);
		} else if (offset !== undefined) {
			return content.slice(offset);
		} else if (length !== undefined) {
			return content.slice(0, length);
		}
		return content;
	}

	async writeFile(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}

	async editFile(
		path: string,
		content: string,
		offset: number,
		length: number,
	): Promise<void> {
		const existing = this.files.get(path);
		if (existing === undefined) {
			throw new Error(`File not found: ${path}`);
		}
		this.files.set(
			path,
			existing.slice(0, offset) + content + existing.slice(offset + length),
		);
	}

	async listFiles(directory: string): Promise<string[]> {
		const prefix = directory.endsWith("/") ? directory : directory + "/";
		return Array.from(this.files.keys()).filter((path) =>
			path.startsWith(prefix),
		);
	}

	async deleteFile(path: string): Promise<void> {
		this.files.delete(path);
	}
}
