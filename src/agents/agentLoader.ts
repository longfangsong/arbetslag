import type { Template } from "../model/agent";

/**
 * Load agent templates from a directory on the filesystem (Node.js only).
 * Uses dynamic imports so Node.js builtins are not bundled — edge runtimes
 * should pass templates directly instead.
 */
async function loadTemplatesFromDir(
  configDir: string,
): Promise<Template[]> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const files = (await fs.readdir(configDir)).filter((f) => f.endsWith(".json"));

  const templates: Template[] = [];
  for (const file of files) {
    const filePath = path.join(configDir, file);
    const content = await fs.readFile(filePath, "utf-8");
    templates.push(JSON.parse(content) as Template);
  }
  return templates;
}

/**
 * Load agent templates. Accepts either:
 * - a directory path (Node.js, reads JSON files from disk)
 * - an array of Template objects (edge/runtime-agnostic)
 */
export async function loadTemplates(
  configOrTemplates: string | Template[],
): Promise<Template[]> {
  if (Array.isArray(configOrTemplates)) {
    return configOrTemplates;
  }
  return loadTemplatesFromDir(configOrTemplates);
}
