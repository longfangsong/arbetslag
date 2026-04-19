export interface FileSystem {
  readFile(path: string, offset?: number, length?: number): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  editFile(
    path: string,
    content: string,
    offset: number,
    length: number,
  ): Promise<void>;
  listFiles(directory: string): Promise<string[]>;
  deleteFile(path: string): Promise<void>;
}
