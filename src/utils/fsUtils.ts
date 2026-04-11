import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Utility for checking if files exist.
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Utility for reading file content as string.
 */
export function readFileAsString(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Utility for writing string to file.
 */
export function writeFileFromString(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}
