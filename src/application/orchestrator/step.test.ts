import { describe, it, expect, vi, beforeEach } from "vitest";
import { step, completeAgent } from "./step";
import { createMockConfig, createMockState } from "./state.mock";
import { Repository as ToolRepository } from "@/domain/tool/repository";
import { Agent } from "@/domain/agent/model";
import { AgentMessageEvent, MessageEvent } from "@/domain/event/model";
import { Template } from "@/domain/agent/template/model";
import { AIProvider, CompletionResult } from "@/domain/aiProvider/model";
import {
	OutputHandlerRegistry,
	ToParentOutputHandler,
} from "@/domain/outputHandler/model";
import { TestUserOutputHandler } from "@/domain/outputHandler/model.mock";
import { TempUserOutputHandler } from "./step";

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

describe("step() — agent_message routing", () => {
	it("routes agent_message to the target agent and calls handleEvent", async () => {
		const mockProvider: AIProvider = {
			name: "test",
			complete: async (): Promise<CompletionResult> => ({
				role: "assistant",
				content: "done",
			}),
		};
		const config = createMockConfig({ aiProviders: [mockProvider] });
		const state = createMockState();
		const template = makeTemplate();
		const agent = Agent.create(template);
		await state.agentRepository.add(agent);

		const event: AgentMessageEvent = {
			id: "evt-1",
			to_agent_id: agent.id,
			event_type: "agent_message",
			payload: { content: "Hello from parent" },
		};

		await step(config, state, event);

		// Agent should have received the message in its history (handleEvent was called)
		expect(agent.history).toContainEqual({
			role: "user",
			content: "Hello from parent",
		});
		// complete() ran and pushed the assistant response into history
		expect(agent.history).toContainEqual({
			role: "assistant",
			content: "done",
		});
	});

	it("throws when agent_message is missing to_agent_id", async () => {
		const config = createMockConfig();
		const state = createMockState();
		const badEvent = {
			id: "evt-2",
			event_type: "agent_message",
			payload: { content: "no target" },
		} as unknown as AgentMessageEvent;

		await expect(step(config, state, badEvent)).rejects.toThrow(
			"agent_message event is missing target agent ID",
		);
	});

	it("throws when target agent does not exist", async () => {
		const config = createMockConfig();
		const state = createMockState();
		const event: AgentMessageEvent = {
			id: "evt-3",
			to_agent_id: "nonexistent",
			event_type: "agent_message",
			payload: { content: "ghost agent" },
		};

		await expect(step(config, state, event)).rejects.toThrow(
			"Agent with ID nonexistent not found",
		);
	});
});

describe("step() — message event with output handler registry", () => {
	it("uses registered handler from registry when available", async () => {
		const mockProvider: AIProvider = {
			name: "test",
			complete: async (): Promise<CompletionResult> => ({
				role: "assistant",
				content: "done",
			}),
		};
		const registry = new OutputHandlerRegistry();
		const registeredHandler = new TestUserOutputHandler("telegram", "chat-123");
		registry.register("telegram", "chat-123", registeredHandler);

		const config = createMockConfig({
			aiProviders: [mockProvider],
			outputHandlerRegistry: registry,
		});
		const state = createMockState();
		const template = makeTemplate();
		await config.agentTemplateRepository.add(template);

		const event: MessageEvent = {
			id: "msg-1",
			chat_id: "chat-123",
			adapter: "telegram",
			event_type: "message",
			payload: { content: "Hello from Telegram" },
		};

		await step(config, state, event);

		// The registered handler should be attached to the created agent
		const agent = await state.agentRepository.getById(
			(await state.chatRepository.getById("chat-123"))!.entry_agent_id,
		);
		expect(agent).not.toBeNull();
		expect(agent!.outputHandler).toBe(registeredHandler);
	});

	it("creates TempUserOutputHandler fallback when no handler is registered", async () => {
		const mockProvider: AIProvider = {
			name: "test",
			complete: async (): Promise<CompletionResult> => ({
				role: "assistant",
				content: "done",
			}),
		};
		const registry = new OutputHandlerRegistry();
		const config = createMockConfig({
			aiProviders: [mockProvider],
			outputHandlerRegistry: registry,
		});
		const state = createMockState();
		const template = makeTemplate();
		await config.agentTemplateRepository.add(template);

		const event: MessageEvent = {
			id: "msg-2",
			chat_id: "chat-456",
			adapter: "unknown",
			event_type: "message",
			payload: { content: "Hello from unknown adapter" },
		};

		await step(config, state, event);

		// A handler should still be created (TempUserOutputHandler fallback)
		const agent = await state.agentRepository.getById(
			(await state.chatRepository.getById("chat-456"))!.entry_agent_id,
		);
		expect(agent).not.toBeNull();
		expect(agent!.outputHandler.tag).toBe("user");
		expect(agent!.outputHandler).toBeInstanceOf(TempUserOutputHandler);
	});

	it("reuses existing agent and handler for subsequent messages to same chat", async () => {
		const mockProvider: AIProvider = {
			name: "test",
			complete: async (): Promise<CompletionResult> => ({
				role: "assistant",
				content: "done",
			}),
		};
		const registry = new OutputHandlerRegistry();
		const handler1 = new TestUserOutputHandler("telegram", "chat-789");
		registry.register("telegram", "chat-789", handler1);

		const config = createMockConfig({
			aiProviders: [mockProvider],
			outputHandlerRegistry: registry,
		});
		const state = createMockState();
		const template = makeTemplate();
		await config.agentTemplateRepository.add(template);

		// First message creates the agent
		const event1: MessageEvent = {
			id: "msg-3a",
			chat_id: "chat-789",
			adapter: "telegram",
			event_type: "message",
			payload: { content: "First message" },
		};
		await step(config, state, event1);

		const agent1 = await state.agentRepository.getById(
			(await state.chatRepository.getById("chat-789"))!.entry_agent_id,
		);

		// Second message reuses the same agent
		const event2: MessageEvent = {
			id: "msg-3b",
			chat_id: "chat-789",
			adapter: "telegram",
			event_type: "message",
			payload: { content: "Second message" },
		};
		await step(config, state, event2);

		const agent2 = await state.agentRepository.getById(
			(await state.chatRepository.getById("chat-789"))!.entry_agent_id,
		);
		expect(agent2!.id).toBe(agent1!.id);
		// Same handler instance should be attached
		expect(agent2!.outputHandler).toBe(handler1);
	});
});

describe("complete() — routes content through outputHandler", () => {
	it("routes agent text response through ToParentOutputHandler", async () => {
		const mockProvider: AIProvider = {
			name: "test",
			complete: async (): Promise<CompletionResult> => ({
				role: "assistant",
				content: "I can help with that",
			}),
		};
		const registry = new OutputHandlerRegistry();
		const config = createMockConfig({
			aiProviders: [mockProvider],
			outputHandlerRegistry: registry,
		});
		const state = createMockState();
		const template = makeTemplate();
		const parentAgent = Agent.create(template);
		await state.agentRepository.add(parentAgent);

		// Create a sub-agent with ToParentOutputHandler
		const subAgent = Agent.create(
			template,
			new ToParentOutputHandler(parentAgent.id),
		);
		subAgent.history.push({ role: "user", content: "What is 2+2?" });
		await state.agentRepository.add(subAgent);

		// Process the sub-agent's event (which triggers complete())
		const event: AgentMessageEvent = {
			id: "evt-complete-1",
			to_agent_id: subAgent.id,
			event_type: "agent_message",
			payload: { content: "What is 2+2?" },
		};
		await step(config, state, event);

		// Agent should have received the user message and the assistant response in history
		expect(subAgent.history).toContainEqual({
			role: "user",
			content: "What is 2+2?",
		});
		expect(subAgent.history).toContainEqual({
			role: "assistant",
			content: "I can help with that",
		});
		// ToParentOutputHandler should have queued an agent_message event targeting the parent
		const queuedEvent = state.eventQueue.find(
			(e) => e.event_type === "agent_message",
		) as AgentMessageEvent | undefined;
		expect(queuedEvent).toBeDefined();
		expect(queuedEvent!.to_agent_id).toBe(parentAgent.id);
		expect(queuedEvent!.payload.content).toBe("I can help with that");
	});

	it("routes content even when tool calls are also present", async () => {
		const mockProvider: AIProvider = {
			name: "test",
			complete: async (): Promise<CompletionResult> => ({
				role: "assistant",
				content: "Let me check that for you",
				tool_calls: [
					{ id: "tc-1", tool_name: "search", arguments: { query: "answer" } },
				],
			}),
		};
		const registry = new OutputHandlerRegistry();
		const config = createMockConfig({
			aiProviders: [mockProvider],
			outputHandlerRegistry: registry,
		});
		const state = createMockState();
		const template = makeTemplate();
		const parentAgent = Agent.create(template);
		await state.agentRepository.add(parentAgent);

		const subAgent = Agent.create(
			template,
			new ToParentOutputHandler(parentAgent.id),
		);
		subAgent.history.push({ role: "user", content: "Search for X" });
		await state.agentRepository.add(subAgent);

		const event: AgentMessageEvent = {
			id: "evt-complete-2",
			to_agent_id: subAgent.id,
			event_type: "agent_message",
			payload: { content: "Search for X" },
		};
		await step(config, state, event);

		// Both content and tool_call events should be queued
		const contentEvent = state.eventQueue.find(
			(e) => e.event_type === "agent_message",
		);
		const toolCallEvent = state.eventQueue.find(
			(e) => e.event_type === "tool_call",
		);
		expect(contentEvent).toBeDefined();
		expect((contentEvent as AgentMessageEvent).payload.content).toBe(
			"Let me check that for you",
		);
		expect(toolCallEvent).toBeDefined();
		expect((toolCallEvent as any).payload.tool_name).toBe("search");
	});
});

describe("completeAgent()", () => {
	let mockProvider: AIProvider;
	let template: Template;
	let agent: Agent;

	beforeEach(() => {
		mockProvider = {
			name: "test-provider",
			complete: vi.fn().mockResolvedValue({
				role: "assistant",
				content: "Hello from AI",
			}),
		};
		template = makeTemplate({ ai_provider: "test-provider" });
		agent = Agent.create(template);
	});

	it("resolves provider by template ai_provider name", async () => {
		const config = createMockConfig({ aiProviders: [mockProvider] });
		const state = createMockState();

		await completeAgent(config, state, agent);

		expect(mockProvider.complete).toHaveBeenCalledWith(
			"test-model",
			[],
			[],
		);
	});

	it("filters tools by template allowedTools", async () => {
		const toolRepo = new ToolRepository();
		const searchTool = {
			name: "search",
			description: "Search the web",
			inputSchema: {} as any,
			call: async () => ("result" as any),
		};
		const weatherTool = {
			name: "weather",
			description: "Get weather",
			inputSchema: {} as any,
			call: async () => ("sunny" as any),
		};
		toolRepo.tools.push(searchTool, weatherTool);

		const toolFilteredTemplate = makeTemplate({
			ai_provider: "test-provider",
			allowedTools: ["search"],
		});
		const filteredAgent = Agent.create(toolFilteredTemplate);
		const config = createMockConfig({
			aiProviders: [mockProvider],
			toolRepository: toolRepo,
		});
		const state = createMockState();

		await completeAgent(config, state, filteredAgent);

		const calledTools = ((mockProvider as any).complete.mock.calls[0][2] as any[]);
		expect(calledTools).toHaveLength(1);
		expect(calledTools[0].name).toBe("search");
	});

	it("routes assistant content through outputHandler", async () => {
		const registry = new OutputHandlerRegistry();
		const outputHandler = new TestUserOutputHandler("telegram", "chat-1");
		const spy = vi.spyOn(outputHandler, "handle");
		const config = createMockConfig({
			aiProviders: [mockProvider],
			outputHandlerRegistry: registry,
		});
		const state = createMockState();
		const agentWithHandler = Agent.create(template, outputHandler);

		await completeAgent(config, state, agentWithHandler);

		expect(spy).toHaveBeenCalledWith(state, agentWithHandler, "Hello from AI");
	});

	it("queues tool calls as ToolCallEvent in eventQueue", async () => {
		const toolCallProvider: AIProvider = {
			name: "test-provider",
			complete: vi.fn().mockResolvedValue({
				role: "assistant",
				content: "Let me check",
				tool_calls: [
					{ id: "tc-1", tool_name: "search", arguments: { q: "x" } },
					{ tool_name: "weather", arguments: {} },
				],
			}),
		};
		const config = createMockConfig({ aiProviders: [toolCallProvider] });
		const state = createMockState();
		const agentWithTools = Agent.create(template);

		await completeAgent(config, state, agentWithTools);

		const toolCallEvents = state.eventQueue.filter(
			(e) => e.event_type === "tool_call",
		);
		expect(toolCallEvents).toHaveLength(2);
		expect(toolCallEvents[0]).toMatchObject({
			event_type: "tool_call",
			to_agent_id: agentWithTools.id,
			payload: { tool_name: "search", arguments: { q: "x" } },
		});
		expect(toolCallEvents[1]).toMatchObject({
			event_type: "tool_call",
			to_agent_id: agentWithTools.id,
			payload: { tool_name: "weather" },
		});
	});

	it("throws when provider is not found", async () => {
		const config = createMockConfig({ aiProviders: [] });
		const state = createMockState();

		await expect(completeAgent(config, state, agent)).rejects.toThrow(
			"AI provider test-provider not found",
		);
	});

	it("pushes AI response to agent history", async () => {
		const config = createMockConfig({ aiProviders: [mockProvider] });
		const state = createMockState();

		await completeAgent(config, state, agent);

		expect(agent.history).toContainEqual({
			role: "assistant",
			content: "Hello from AI",
		});
	});
});
