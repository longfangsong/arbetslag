import { describe, it, expect } from "vitest";
import { step } from "./step";
import { createMockState } from "./state.mock";
import { Agent } from "@/domain/agent/model";
import { AgentMessageEvent, MessageEvent } from "@/domain/event/model";
import { Template } from "@/domain/agent/template/model";
import { AIProvider, CompletionResult } from "@/domain/aiProvider/model";
import { OutputHandlerRegistry } from "@/domain/outputHandler/model";
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
