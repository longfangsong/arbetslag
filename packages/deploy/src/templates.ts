import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { type Registry, type WorkflowTemplate, InstantiateError, instantiate } from "@arbetslag/kernel";
import type { Templates } from "@arbetslag/host-node";
import { parse } from "yaml";

const EXTENSIONS = new Set([".json", ".yaml", ".yml"]);

/**
 * 模板目录（ADR-0018）：每个 `.json` / `.yaml` / `.yml` 文件一份模板，文件名去掉扩展名就是模板名。
 * 只看这一层，不递归。返回模板与问题清单（同名、读不了、不是对象）。
 */
export async function loadTemplates(directory: string): Promise<{ templates: Templates; issues: string[] }> {
	const issues: string[] = [];
	const templates: Record<string, WorkflowTemplate> = {};
	const origin = new Map<string, string>();

	let entries: string[];
	try {
		entries = (await readdir(directory, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && EXTENSIONS.has(extname(entry.name)))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		return { templates, issues: [`templates: cannot read ${directory}: ${message(error)}`] };
	}

	for (const file of entries) {
		const name = file.slice(0, -extname(file).length);
		const seen = origin.get(name);
		if (seen !== undefined) {
			issues.push(`templates: ${seen} and ${file} are both named ${JSON.stringify(name)}`);
			continue;
		}
		origin.set(name, file);
		try {
			const text = await readFile(join(directory, file), "utf8");
			const value: unknown = extname(file) === ".json" ? JSON.parse(text) : parse(text);
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				issues.push(`templates/${file}: not a template object`);
				continue;
			}
			templates[name] = value as WorkflowTemplate;
		} catch (error) {
			issues.push(`templates/${file}: ${message(error)}`);
		}
	}
	return { templates, issues };
}

/** 每份模板按默认参数试实例化一遍（不落盘）：配置错误在启动时就报，而不是第一条消息进来时。 */
export function checkTemplates(registry: Registry, templates: Templates): string[] {
	const issues: string[] = [];
	for (const [name, template] of Object.entries(templates)) {
		if (template === undefined) continue;
		try {
			instantiate(registry, template);
		} catch (error) {
			if (!(error instanceof InstantiateError)) throw error;
			for (const violation of error.violations) issues.push(`templates/${name}: ${JSON.stringify(violation)}`);
		}
	}
	return issues;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
