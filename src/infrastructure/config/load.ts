import { parseConfigFile } from "./parser";
import { configSchema } from "./schema";
import { OpenAIProvider } from "@/infrastructure/aiProvider/openai";
import { Repository as AgentTemplateRepository } from "@/domain/agent/template/repository";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import type { Config } from "@/application/orchestrator";
import type { AIProvider } from "@/domain/aiProvider/model";
import type { Tool } from "@/domain/tool/model";

const providerRegistry = new Map<string, () => AIProvider>();
const toolRegistry = new Map<string, () => Tool<unknown, unknown, unknown>>();

export function registerProvider(name: string, factory: () => AIProvider): void {
	providerRegistry.set(name, factory);
}

export function registerTool(name: string, factory: () => Tool<unknown, unknown, unknown>): void {
	toolRegistry.set(name, factory);
}

/**
 * Load and validate a config file, resolving providers and tools via registries.
 *
 * Providers and tools are instantiated from registered factories keyed by
 * the string names found in the config file.  Templates are added as plain
 * objects to a new AgentTemplateRepository.
 *
 * @returns Partial<Config> with aiProviders, toolRepository,
 *          agentTemplateRepository, and config.
 */
export async function loadConfig(filePath: string): Promise<Partial<Config>> {
	const parsed = await parseConfigFile(filePath);
	const validated = configSchema.parse(parsed);

	const aiProviders: Array<AIProvider> = [];
	for (const name of validated.providers ?? []) {
		const factory = providerRegistry.get(name);
		if (!factory) {
			throw new Error(`Unknown provider type: ${name}`);
		}
		aiProviders.push(factory());
	}

	const toolRepository = new ToolRepository();
	for (const name of validated.tools ?? []) {
		const factory = toolRegistry.get(name);
		if (!factory) {
			throw new Error(`Unknown tool type: ${name}`);
		}
		toolRepository.tools.push(factory());
	}

	const agentTemplateRepository = new AgentTemplateRepository();
	for (const template of validated.templates ?? []) {
		await agentTemplateRepository.add(template);
	}

	return {
		aiProviders,
		toolRepository,
		agentTemplateRepository,
		config: validated.config ?? {},
	};
}

// Register built-in providers & tools by default
registerProvider("openai", () => new OpenAIProvider());
