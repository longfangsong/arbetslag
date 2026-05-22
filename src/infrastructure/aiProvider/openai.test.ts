import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenAIProvider } from "./openai";

// Mock openai before importing OpenAIProvider
const mockChatCompletionsCreate = vi.fn();
const mockOpenAIConstructor = vi.fn();

vi.mock("openai", () => {
	const MockOpenAI = vi.fn(function (this: Record<string, unknown>, opts?: Record<string, unknown>) {
		mockOpenAIConstructor(opts);
		return {
			chat: {
				completions: {
					create: mockChatCompletionsCreate,
				},
			},
		};
	});
	return {
		default: MockOpenAI,
	};
});


describe("OpenAIProvider", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
		vi.clearAllMocks();
		mockChatCompletionsCreate.mockResolvedValue({
			choices: [
				{
					message: { content: "Hello from AI", tool_calls: undefined },
				},
			],
		});
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("constructor", () => {
		it("has a zero-argument constructor", () => {
			process.env.OPENAI_API_KEY = "test-key";
			expect(() => new OpenAIProvider()).not.toThrow();
		});

		it("defaults name to 'openai'", () => {
			process.env.OPENAI_API_KEY = "test-key";
			const provider = new OpenAIProvider();
			expect(provider.name).toBe("openai");
		});

		it("creates OpenAI client during construction", () => {
			process.env.OPENAI_API_KEY = "test-key";
			new OpenAIProvider();
			expect(mockOpenAIConstructor).toHaveBeenCalledTimes(1);
		});
	});

	describe("env var reading", () => {
		it("reads OPENAI_API_KEY from process.env", async () => {
			process.env.OPENAI_API_KEY = "my-secret-key";
			const provider = new OpenAIProvider();

			await provider.complete("gpt-4", [], []);

			expect(mockOpenAIConstructor).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: "my-secret-key" }),
			);
		});

		it("reads OPENAI_BASE_URL from process.env", async () => {
			process.env.OPENAI_API_KEY = "test-key";
			process.env.OPENAI_BASE_URL = "http://localhost:11434/v1";
			const provider = new OpenAIProvider();

			await provider.complete("gpt-4", [], []);

			expect(mockOpenAIConstructor).toHaveBeenCalledWith(
				expect.objectContaining({
					baseURL: "http://localhost:11434/v1",
					apiKey: "test-key",
				}),
			);
		});

		it("passes undefined baseUrl when OPENAI_BASE_URL is not set", async () => {
			process.env.OPENAI_API_KEY = "test-key";
			delete process.env.OPENAI_BASE_URL;
			const provider = new OpenAIProvider();

			await provider.complete("gpt-4", [], []);

			expect(mockOpenAIConstructor).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: "test-key" }),
			);
			const callArgs = mockOpenAIConstructor.mock.calls[0][0];
			expect(callArgs?.baseURL).toBeUndefined();
		});
	});

	describe("complete()", () => {
		it("reuses OpenAI client on subsequent calls", async () => {
			process.env.OPENAI_API_KEY = "test-key";
			const provider = new OpenAIProvider();

			await provider.complete("gpt-4", [], []);
			await provider.complete("gpt-4", [], []);

			expect(mockOpenAIConstructor).toHaveBeenCalledTimes(1);
		});

		it("returns completion result with tool calls", async () => {
			process.env.OPENAI_API_KEY = "test-key";
			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [
					{
						message: {
							content: "Let me use a tool",
							tool_calls: [
								{
									id: "tc-1",
									type: "function",
									function: {
										name: "search",
										arguments: JSON.stringify({ query: "test" }),
									},
								},
							],
						},
					},
				],
			});

			const provider = new OpenAIProvider();
			const result = await provider.complete("gpt-4", [], []);

			expect(result.role).toBe("assistant");
			expect(result.content).toBe("Let me use a tool");
			expect(result.tool_calls).toHaveLength(1);
			expect(result.tool_calls?.[0]).toEqual({
				id: "tc-1",
				tool_name: "search",
				arguments: { query: "test" },
			});
		});

		it("throws when no completion choice is returned", async () => {
			process.env.OPENAI_API_KEY = "test-key";
			mockChatCompletionsCreate.mockResolvedValueOnce({
				choices: [],
			});

			const provider = new OpenAIProvider();

			await expect(provider.complete("gpt-4", [], [])).rejects.toThrow(
				"No completion choice returned",
			);
		});
	});
});
