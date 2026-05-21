import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramOutputHandler } from "./telegram";
import { MutableState } from "@/application/orchestrator";
import { Agent } from "@/domain/agent/model";
import { Template } from "@/domain/agent/template/model";
import { Repository as AgentRepository } from "@/domain/agent/repository";
import { Repository as ChatRepository } from "@/domain/chat/repository";

function makeMockState(): MutableState {
	return {
		agentRepository: new AgentRepository(),
		chatRepository: new ChatRepository(),
		eventQueue: [],
		toolState: {},
	};
}

function makeTemplate(overrides?: Partial<Template>): Template {
	return {
		name: "test",
		description: "A test template",
		ai_provider: "test",
		model: "test-model",
		systemPrompt: "You are a test agent.",
		allowedTools: [],
		...overrides,
	};
}

describe("TelegramOutputHandler", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("sends message via Telegram Bot API on success", async () => {
		const mockResponse = { ok: true, result: { message_id: 42 } };
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => mockResponse,
		});
		vi.stubGlobal("fetch", fetchMock);

		const handler = new TelegramOutputHandler(
			"telegram",
			"12345",
			"fake-token",
		);
		const state = makeMockState();
		const template = makeTemplate();
		const agent = Agent.create(template, handler);

		await handler.handle(state, agent, "Hello from agent");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.telegram.org/botfake-token/sendMessage",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: "12345", text: "Hello from agent" }),
			}),
		);
	});

	it("throws on Telegram API error", async () => {
		const mockResponse = { ok: false, description: "Chat not found" };
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => mockResponse,
		});
		vi.stubGlobal("fetch", fetchMock);

		const handler = new TelegramOutputHandler(
			"telegram",
			"99999",
			"fake-token",
		);
		const state = makeMockState();
		const template = makeTemplate();
		const agent = Agent.create(template, handler);

		await expect(handler.handle(state, agent, "Hello")).rejects.toThrow(
			"Telegram API error: Chat not found",
		);
	});

	it("returns state unchanged on success", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({ ok: true, result: { message_id: 1 } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const handler = new TelegramOutputHandler(
			"telegram",
			"12345",
			"fake-token",
		);
		const state = makeMockState();
		const template = makeTemplate();
		const agent = Agent.create(template, handler);

		const result = await handler.handle(state, agent, "test");

		expect(result).toBe(state);
	});
});
