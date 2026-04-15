import { nanoid } from "nanoid/non-secure";
import { promises as fs } from "fs";
import path from "path";

export interface FileSystem {
    readFile(path: string, offset?: number, length?: number): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    editFile(path: string, content: string, offset: number, length: number): Promise<void>;
    listFiles(directory: string): Promise<string[]>;
    deleteFile(path: string): Promise<void>;
}

export class InMemoryFileSystem implements FileSystem {
    private files: Map<string, string> = new Map();
    
    async readFile(path: string, offset?: number, length?: number): Promise<string> {
        const fullContent = this.files.get(path) || "";
        if (offset !== undefined) {
            const start = Math.max(0, offset);
            const end = length !== undefined ? start + length : fullContent.length;
            return fullContent.slice(start, end);
        }
        return fullContent;
    }

    async writeFile(path: string, content: string): Promise<void> {
        this.files.set(path, content);
    }

    async editFile(path: string, content: string, offset: number, length: number): Promise<void> {
        const originalContent = this.files.get(path) || "";
        const start = Math.max(0, offset);
        const end = Math.min(originalContent.length, start + length);
        const newContent = originalContent.slice(0, start) + content + originalContent.slice(end);
        this.files.set(path, newContent);
    }

    async listFiles(directory: string): Promise<string[]> {
        const prefix = directory.endsWith("/") ? directory : directory + "/";
        const filesInDirectory = [];
        for (const filePath of this.files.keys()) {
            if (filePath.startsWith(prefix)) {
                const relativePath = filePath.slice(prefix.length);
                if (!relativePath.includes("/")) { // Only include files directly in the directory
                    filesInDirectory.push(relativePath);
                }
            }
        }
        return filesInDirectory;
    }

    async deleteFile(path: string): Promise<void> {
        this.files.delete(path);
    }
}

export class OnDiskFileSystem implements FileSystem {
    constructor(private basePath: string) {}

    async readFile(filePath: string, offset?: number, length?: number): Promise<string> {
        const fullPath = path.join(this.basePath, filePath);
        const content = await fs.readFile(fullPath, "utf-8");
        
        if (offset !== undefined) {
            const start = Math.max(0, offset);
            const end = length !== undefined ? start + length : content.length;
            return content.slice(start, end);
        }
        return content;
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        const fullPath = path.join(this.basePath, filePath);
        // Ensure directory exists
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, content, "utf-8");
    }

    async editFile(filePath: string, content: string, offset: number, length: number): Promise<void> {
        const fullPath = path.join(this.basePath, filePath);
        const originalContent = await fs.readFile(fullPath, "utf-8");
        const start = Math.max(0, offset);
        const end = Math.min(originalContent.length, start + length);
        const newContent = originalContent.slice(0, start) + content + originalContent.slice(end);
        await fs.writeFile(fullPath, newContent, "utf-8");
    }

    async listFiles(directory: string): Promise<string[]> {
        const fullPath = path.join(this.basePath, directory);
        try {
            const entries = await fs.readdir(fullPath, { withFileTypes: true });
            return entries
                .filter((entry: any) => entry.isFile())
                .map((entry: any) => entry.name);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async deleteFile(filePath: string): Promise<void> {
        const fullPath = path.join(this.basePath, filePath);
        await fs.unlink(fullPath);
    }
}

export class Session {
    id: string;
    constructor(public fileSystem: FileSystem) {
        this.id = nanoid(10);
    }
    recordMessages(agentId: string, messages: Array<{role: string; content: string}>): Promise<void> {
        const path = `run/${this.id}/${agentId}.json`;
        return this.fileSystem.writeFile(path, JSON.stringify(messages));
    }
}