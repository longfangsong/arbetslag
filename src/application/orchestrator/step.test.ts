import { describe, it, expect } from "vitest";
import { step } from "./step";
import { createMockState } from "./state.mock";
import { Agent } from "@/domain/agent/model";
import { AgentMessageEvent } from "@/domain/event/model";
import { Template } from "@/domain/agent/template/model";
import { AIProvider, CompletionResult } from "@/domain/aiProvider/model";

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
