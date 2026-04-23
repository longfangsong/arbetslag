import type { Template } from "../model/agent";
import fs from "fs/promises";
import path from "path";

export async function loadTemplates(configDir: string): Promise<Template[]> {
    const templates = [];
    
    const files = (await fs.readdir(configDir)).filter(f => f.endsWith(".json"));
    
    for (const file of files) {
        const filePath = path.join(configDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const template = JSON.parse(content) as Template;
        templates.push(template);
    }
    
    return templates;
}
