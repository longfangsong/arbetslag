import { describe, it, expect } from "vitest";
import { step } from "./step";
import { createMockState } from "./state.mock";
import { Agent } from "@/domain/agent/model";
import { AgentMessageEvent, MessageEvent } from "@/domain/event/model";
import { Template } from "@/domain/agent/template/model";
import { AIProvider, CompletionResult } from "@/domain/aiProvider/model";
import { OutputHandlerRegistry, ToParentOutputHandler } from "@/domain/outputHandler/model";
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
            complete: async (): Promise<CompletionResult> => ({ role: "assistant", content: "done" }),
        };
        const state = createMockState({ aiProviders: [mockProvider] });
        const template = makeTemplate();
        const agent = Agent.create(template);
        await state.agentRepository.add(agent);

        const event: AgentMessageEvent = {
            id: "evt-1",
            to_agent_id: agent.id,
            event_type: "agent_message",
            payload: { content: "Hello from parent" },
        };

        await step(state, event);

        // Agent should have received the message in its history (handleEvent was called)
        expect(agent.history).toContainEqual({ role: "user", content: "Hello from parent" });
        // complete() ran and pushed the assistant response into history
        expect(agent.history).toContainEqual({ role: "assistant", content: "done" });
    });

    it("throws when agent_message is missing to_agent_id", async () => {
        const state = createMockState();
        const badEvent = {
            id: "evt-2",
            event_type: "agent_message",
            payload: { content: "no target" },
        } as unknown as AgentMessageEvent;

        await expect(step(state, badEvent)).rejects.toThrow("agent_message event is missing target agent ID");
    });

    it("throws when target agent does not exist", async () => {
        const state = createMockState();
        const event: AgentMessageEvent = {
            id: "evt-3",
            to_agent_id: "nonexistent",
            event_type: "agent_message",
            payload: { content: "ghost agent" },
        };

        await expect(step(state, event)).rejects.toThrow("Agent with ID nonexistent not found");
    });
});

describe("step() — message event with output handler registry", () => {
    it("uses registered handler from registry when available", async () => {
        const mockProvider: AIProvider = {
            name: "test",
            complete: async (): Promise<CompletionResult> => ({ role: "assistant", content: "done" }),
        };
        const registry = new OutputHandlerRegistry();
        const registeredHandler = new TestUserOutputHandler("telegram", "chat-123");
        registry.register("telegram", "chat-123", registeredHandler);

        const state = createMockState({ aiProviders: [mockProvider], output_handler_registry: registry });
        const template = makeTemplate();
        await state.agentTemplateRepository.add(template);

        const event: MessageEvent = {
            id: "msg-1",
            chat_id: "chat-123",
            adapter: "telegram",
            event_type: "message",
            payload: { content: "Hello from Telegram" },
        };

        await step(state, event);

        // The registered handler should be attached to the created agent
        const agent = await state.agentRepository.getById((await state.chatRepository.getById("chat-123"))!.entry_agent_id);
        expect(agent).not.toBeNull();
        expect(agent!.outputHandler).toBe(registeredHandler);
    });

    it("creates TempUserOutputHandler fallback when no handler is registered", async () => {
        const mockProvider: AIProvider = {
            name: "test",
            complete: async (): Promise<CompletionResult> => ({ role: "assistant", content: "done" }),
        };
        const registry = new OutputHandlerRegistry();
        const state = createMockState({ aiProviders: [mockProvider], output_handler_registry: registry });
        const template = makeTemplate();
        await state.agentTemplateRepository.add(template);

        const event: MessageEvent = {
            id: "msg-2",
            chat_id: "chat-456",
            adapter: "unknown",
            event_type: "message",
            payload: { content: "Hello from unknown adapter" },
        };

        await step(state, event);

        // A handler should still be created (TempUserOutputHandler fallback)
        const agent = await state.agentRepository.getById((await state.chatRepository.getById("chat-456"))!.entry_agent_id);
        expect(agent).not.toBeNull();
        expect(agent!.outputHandler.tag).toBe("user");
        expect(agent!.outputHandler).toBeInstanceOf(TempUserOutputHandler);
    });

    it("reuses existing agent and handler for subsequent messages to same chat", async () => {
        const mockProvider: AIProvider = {
            name: "test",
            complete: async (): Promise<CompletionResult> => ({ role: "assistant", content: "done" }),
        };
        const registry = new OutputHandlerRegistry();
        const handler1 = new TestUserOutputHandler("telegram", "chat-789");
        registry.register("telegram", "chat-789", handler1);

        const state = createMockState({ aiProviders: [mockProvider], output_handler_registry: registry });
        const template = makeTemplate();
        await state.agentTemplateRepository.add(template);

        // First message creates the agent
        const event1: MessageEvent = {
            id: "msg-3a",
            chat_id: "chat-789",
            adapter: "telegram",
            event_type: "message",
            payload: { content: "First message" },
        };
        await step(state, event1);

        const agent1 = await state.agentRepository.getById((await state.chatRepository.getById("chat-789"))!.entry_agent_id);

        // Second message reuses the same agent
        const event2: MessageEvent = {
            id: "msg-3b",
            chat_id: "chat-789",
            adapter: "telegram",
            event_type: "message",
            payload: { content: "Second message" },
        };
        await step(state, event2);

        const agent2 = await state.agentRepository.getById((await state.chatRepository.getById("chat-789"))!.entry_agent_id);
        expect(agent2!.id).toBe(agent1!.id);
        // Same handler instance should be attached
        expect(agent2!.outputHandler).toBe(handler1);
    });
});

describe("complete() — routes content through outputHandler", () => {
    it("routes agent text response through ToParentOutputHandler", async () => {
        const mockProvider: AIProvider = {
            name: "test",
            complete: async (): Promise<CompletionResult> => ({ role: "assistant", content: "I can help with that" }),
        };
        const registry = new OutputHandlerRegistry();
        const state = createMockState({ aiProviders: [mockProvider], output_handler_registry: registry });
        const template = makeTemplate();
        const parentAgent = Agent.create(template);
        await state.agentRepository.add(parentAgent);

        // Create a sub-agent with ToParentOutputHandler
        const subAgent = Agent.create(template, new ToParentOutputHandler(parentAgent.id));
        subAgent.history.push({ role: "user", content: "What is 2+2?" });
        await state.agentRepository.add(subAgent);

        // Process the sub-agent's event (which triggers complete())
        const event: AgentMessageEvent = {
            id: "evt-complete-1",
            to_agent_id: subAgent.id,
            event_type: "agent_message",
            payload: { content: "What is 2+2?" },
        };
        await step(state, event);

        // Agent should have received the user message and the assistant response in history
        expect(subAgent.history).toContainEqual({ role: "user", content: "What is 2+2?" });
        expect(subAgent.history).toContainEqual({ role: "assistant", content: "I can help with that" });
        // ToParentOutputHandler should have queued an agent_message event targeting the parent
        const queuedEvent = state.eventQueue.find(e => e.event_type === "agent_message") as AgentMessageEvent | undefined;
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
                tool_calls: [{ id: "tc-1", tool_name: "search", arguments: { query: "answer" } }],
            }),
        };
        const registry = new OutputHandlerRegistry();
        const state2 = createMockState({ aiProviders: [mockProvider], output_handler_registry: registry });
        const template = makeTemplate();
        const parentAgent = Agent.create(template);
        await state2.agentRepository.add(parentAgent);

        const subAgent = Agent.create(template, new ToParentOutputHandler(parentAgent.id));
        subAgent.history.push({ role: "user", content: "Search for X" });
        await state2.agentRepository.add(subAgent);

        const event: AgentMessageEvent = {
            id: "evt-complete-2",
            to_agent_id: subAgent.id,
            event_type: "agent_message",
            payload: { content: "Search for X" },
        };
        await step(state2, event);

        // Both content and tool_call events should be queued
        const contentEvent = state2.eventQueue.find(e => e.event_type === "agent_message");
        const toolCallEvent = state2.eventQueue.find(e => e.event_type === "tool_call");
        expect(contentEvent).toBeDefined();
        expect((contentEvent as AgentMessageEvent).payload.content).toBe("Let me check that for you");
        expect(toolCallEvent).toBeDefined();
        expect((toolCallEvent as any).payload.tool_name).toBe("search");
    });
});
