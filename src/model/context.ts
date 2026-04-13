import { AIProvider } from "./aiProvider";
import { Tool } from "./tool";

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

export interface Context {
    fileSystem: FileSystem;
    aiProviders: Map<string, AIProvider>;
    tools: Map<string, Tool<any, any>>;
}