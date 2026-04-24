import { FileSystem } from ".";

/**
 * Node.js FileSystem implementation.
 * Uses dynamic imports for Node.js builtins so bundlers (esbuild, etc.)
 * do not try to resolve/inject them at bundle time — keeping the package
 * edge-runtime compatible.
 */
export class NodeFsFileSystem implements FileSystem {
  private baseUrl: string;

  constructor(baseUrl: string = ".") {
    this.baseUrl = baseUrl;
  }

  private async resolvePath(filePath: string): Promise<string> {
    const path = await import("path");
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.baseUrl, filePath);
    return path.resolve(resolved);
  }

  async readFile(
    filePath: string,
    offset?: number,
    length?: number,
  ): Promise<string> {
    const fs = await import("node:fs/promises");
    const resolved = await this.resolvePath(filePath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }
    const buffer = await fs.readFile(resolved);
    let content = buffer.toString("utf-8");
    if (offset !== undefined || length !== undefined) {
      const start = offset ?? 0;
      const end = length !== undefined ? start + length : content.length;
      content = content.slice(start, end);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("path");
    const resolved = await this.resolvePath(filePath);
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
  }

  async editFile(
    filePath: string,
    content: string,
    offset: number,
    length: number,
  ): Promise<void> {
    const fs = await import("node:fs/promises");
    const resolved = await this.resolvePath(filePath);
    const buffer = await fs.readFile(resolved);
    let existing = buffer.toString("utf-8");
    const updated =
      existing.slice(0, offset) + content + existing.slice(offset + length);
    await fs.writeFile(resolved, updated, "utf-8");
  }

  async listFiles(directory: string): Promise<string[]> {
    const fs = await import("node:fs/promises");
    const path = await import("path");
    const resolved = await this.resolvePath(directory);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name));
  }

  async deleteFile(filePath: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const resolved = await this.resolvePath(filePath);
    await fs.unlink(resolved);
  }
}
