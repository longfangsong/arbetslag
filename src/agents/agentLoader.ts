import type { Template } from "../model/agent";

/**
 * Load agent templates from JSON files.
 *
 * @param pathsOrTemplates - Either:
 *   - an array of file paths (strings) to load templates from
 *   - an array of already-parsed Template objects
 *
 * @remarks
 * In Node.js environments, file paths are resolved from the filesystem.
 * In edge environments (Cloudflare Workers, etc.), use the Workers VFS:
 *
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { loadTemplates } from "arbetslag";
 *
 * const templates = await loadTemplates([
 *   "/bundle/configs/taskDispatcher.json",
 *   "/bundle/configs/generalPurposeSubAgent.json",
 * ]);
 * ```
 *
 * Note: The Workers VFS supports `readFileSync` but NOT `readdir`, so you
 * must list your template files explicitly.
 */
export async function loadTemplates(
  pathsOrTemplates: (string | Template)[],
): Promise<Template[]> {
  const templates: Template[] = [];

  for (const item of pathsOrTemplates) {
    if (typeof item === "string") {
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(item, "utf-8");
      templates.push(JSON.parse(content) as Template);
    } else {
      templates.push(item);
    }
  }

  return templates;
}
