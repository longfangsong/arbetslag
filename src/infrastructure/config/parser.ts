import * as fs from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "@iarna/toml";

export async function parseConfigFile(filePath: string): Promise<Record<string, unknown>> {
	const ext = filePath.split(".").pop()?.toLowerCase();

	let content: string;
	try {
		content = await fs.readFile(filePath, "utf-8");
	} catch (err) {
		if (err instanceof Error && "code" in err && err.code === "ENOENT") {
			throw new Error(`Config file not found: ${filePath}`);
		}
		throw err;
	}

	if (ext === "json") {
		return JSON.parse(content);
	}

	if (ext === "yaml" || ext === "yml") {
		return parseYaml(content) as Record<string, unknown>;
	}

	if (ext === "toml") {
		return parseToml(content) as Record<string, unknown>;
	}

	throw new Error(`Unsupported config file extension: .${ext}`);
}
