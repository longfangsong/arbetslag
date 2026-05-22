import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, registerTool } from "./load";
import type { CompletionResult, HistoryEntry } from "@/domain/aiProvider/model";
import type { Tool } from "@/domain/tool/model";
import { GetTime } from "@/infrastructure/tool/getTime";
import { HttpRequest } from "@/infrastructure/tool/http";
import * as fs from "node:fs/promises";
import * as path from "node:path";

vi.mock("@/infrastructure/aiProvider/openai", () => {
	class MockOpenAIProvider {
		name = "openai";
		async complete(
			_model: string,
			_history: Array<HistoryEntry>,
			_allowedTools: Array<Tool<unknown, unknown, unknown>>,
		): Promise<CompletionResult> {
			return { role: "assistant", content: "mock" };
		}
	}
	return { OpenAIProvider: MockOpenAIProvider };
});

const tmpDir = path.join(process.cwd(), ".test-tmp", "config");

beforeEach(async () => {
	await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
	try {
		await fs.rm(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
});

async function writeConfigFile(name: string, content: unknown): Promise<string> {
	const filePath = path.join(tmpDir, name);
	await fs.writeFile(filePath, JSON.stringify(content, null, 2));
	return filePath;
}

describe("loadConfig integration", () => {
	it("loads providers, tools, and templates from a JSON config file", async () => {
		const { OpenAIProvider } = await import("@/infrastructure/aiProvider/openai");

		registerTool("getTime", () => new GetTime());
		registerTool("httpRequest", () => new HttpRequest());

		const filePath = await writeConfigFile("full.json", {
			providers: ["openai"],
			tools: ["getTime", "httpRequest"],
			templates: [
				{
					name: "assistant",
					description: "A helpful assistant",
					ai_provider: "openai",
					model: "gpt-4",
					systemPrompt: "You are helpful.",
					allowedTools: ["getTime"],
				},
			],
			config: { debug: true },
		});

		const result = await loadConfig(filePath);

		expect(result.aiProviders).toHaveLength(1);
		expect(result.aiProviders![0]).toBeInstanceOf(OpenAIProvider);
		expect(result.aiProviders![0].name).toBe("openai");

		expect(result.toolRepository!.tools).toHaveLength(2);
		const toolNames = result.toolRepository!.tools.map((t) => t.name);
		expect(toolNames).toContain("get_time");
		expect(toolNames).toContain("http_request");

		expect(result.agentTemplateRepository).toBeDefined();
		const templates = await result.agentTemplateRepository!.list();
		expect(templates).toHaveLength(1);
		expect(templates[0].name).toBe("assistant");
		expect(templates[0].ai_provider).toBe("openai");

		expect(result.config).toEqual({ debug: true });
	});

	it("handles minimal config with only providers", async () => {
		const { OpenAIProvider } = await import("@/infrastructure/aiProvider/openai");

		const filePath = await writeConfigFile("minimal.json", {
			providers: ["openai"],
		});

		const result = await loadConfig(filePath);

		expect(result.aiProviders).toHaveLength(1);
		expect(result.aiProviders![0]).toBeInstanceOf(OpenAIProvider);
		expect(result.toolRepository!.tools).toHaveLength(0);
		expect((await result.agentTemplateRepository!.list()).length).toBe(0);
		expect(result.config).toEqual({});
	});

	it("handles empty config", async () => {
		const filePath = await writeConfigFile("empty.json", {});

		const result = await loadConfig(filePath);

		expect(result.aiProviders).toHaveLength(0);
		expect(result.toolRepository!.tools).toHaveLength(0);
		expect((await result.agentTemplateRepository!.list()).length).toBe(0);
		expect(result.config).toEqual({});
	});

	it("throws on unknown provider type", async () => {
		const filePath = await writeConfigFile("unknown-provider.json", {
			providers: ["unknown-provider"],
		});

		await expect(loadConfig(filePath)).rejects.toThrow(
			"Unknown provider type: unknown-provider",
		);
	});

	it("throws on unknown tool type", async () => {
		const filePath = await writeConfigFile("unknown-tool.json", {
			providers: ["openai"],
			tools: ["unknown-tool"],
		});

		await expect(loadConfig(filePath)).rejects.toThrow(
			"Unknown tool type: unknown-tool",
		);
	});

	it("throws on schema validation failure", async () => {
		const filePath = await writeConfigFile("invalid.json", {
			providers: "not-an-array",
		});

		await expect(loadConfig(filePath)).rejects.toThrow();
	});
});
