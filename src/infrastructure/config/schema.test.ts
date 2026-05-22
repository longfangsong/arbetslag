import { describe, it, expect } from "vitest";
import { configSchema } from "./schema";

describe("configSchema", () => {
	it("validates empty object", () => {
		const result = configSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it("validates providers array", () => {
		const result = configSchema.safeParse({
			providers: ["openai", "anthropic"],
		});
		expect(result.success).toBe(true);
	});

	it("rejects providers with non-string items", () => {
		const result = configSchema.safeParse({
			providers: ["openai", 42],
		});
		expect(result.success).toBe(false);
	});

	it("validates tools array", () => {
		const result = configSchema.safeParse({
			tools: ["getTime", "httpRequest"],
		});
		expect(result.success).toBe(true);
	});

	it("rejects tools with non-string items", () => {
		const result = configSchema.safeParse({
			tools: ["getTime", true],
		});
		expect(result.success).toBe(false);
	});

	it("validates templates array", () => {
		const result = configSchema.safeParse({
			templates: [
				{
					name: "test",
					description: "A test template",
					ai_provider: "openai",
					model: "gpt-4",
					systemPrompt: "You are helpful.",
					allowedTools: ["getTime"],
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects templates with missing required fields", () => {
		const result = configSchema.safeParse({
			templates: [
				{
					name: "test",
					// missing description, ai_provider, model, systemPrompt, allowedTools
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("validates config record", () => {
		const result = configSchema.safeParse({
			config: { apiKey: "secret", timeout: 5000 },
		});
		expect(result.success).toBe(true);
	});

	it("accepts config with any value types", () => {
		const result = configSchema.safeParse({
			config: { string: "a", number: 42, bool: true, null: null },
		});
		expect(result.success).toBe(true);
	});

	it("validates all keys together", () => {
		const result = configSchema.safeParse({
			providers: ["openai"],
			tools: ["getTime"],
			templates: [
				{
					name: "test",
					description: "A test template",
					ai_provider: "openai",
					model: "gpt-4",
					systemPrompt: "You are helpful.",
					allowedTools: ["getTime"],
				},
			],
			config: { apiKey: "secret" },
		});
		expect(result.success).toBe(true);
	});

	it("rejects unknown top-level keys", () => {
		const result = configSchema.safeParse({
			unknownKey: "value",
		});
		expect(result.success).toBe(false);
	});
});
