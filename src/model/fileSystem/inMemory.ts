import { FileSystem } from ".";

export class InMemoryFileSystem implements FileSystem {
  private files: Map<string, string> = new Map();

  async readFile(
    path: string,
    _offset?: number,
    _length?: number,
  ): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async editFile(
    path: string,
    content: string,
    _offset: number,
    _length: number,
  ): Promise<void> {
    const existing = this.files.get(path);
    if (existing === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    this.files.set(
      path,
      existing.slice(0, _offset) + content + existing.slice(_offset + _length),
    );
  }

  async listFiles(_directory: string): Promise<string[]> {
    return Array.from(this.files.keys());
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
}
