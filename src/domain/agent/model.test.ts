import { describe, it, expect } from "vitest";
import { Agent } from "./model";
import { Template } from "./template/model";
import { Repository as TemplateRepository } from "./template/repository";
import { Repository as AgentRepository } from "./repository";
import { UserOutputHandler, ToParentOutputHandler, OutputHandlerRegistry } from "../outputHandler/model";

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

describe("Agent serialization round-trip", () => {
    it("serializes and deserializes a root agent with UserOutputHandler", async () => {
        const registry = new OutputHandlerRegistry();
        const userHandler = new UserOutputHandler("telegram", "chat-123");
        registry.register("telegram", "chat-123", userHandler);

        const template = makeTemplate();
        const agent = Agent.create(template, userHandler);
        agent.history.push({ role: "user", content: "Hello" });

        const serialized = agent.serialize();
        expect(serialized.output_handler).toEqual({ type: "user", adapter: "telegram", chat_id: "chat-123" });

        const templateRepo = new TemplateRepository();
        await templateRepo.add(template);

        const deserialized = await Agent.deserialize(serialized, templateRepo, registry);
        expect(deserialized.id).toBe(agent.id);
        expect(deserialized.template.name).toBe(template.name);
        expect(deserialized.history).toEqual(agent.history);
        expect(deserialized.outputHandler).toBe(userHandler);
    });

    it("serializes and deserializes a sub-agent with ToParentOutputHandler", async () => {
        const template = makeTemplate();
        const parentHandler = new ToParentOutputHandler("parent-456");
        const agent = Agent.create(template, parentHandler);
        agent.history.push({ role: "user", content: "Sub-agent message" });

        const serialized = agent.serialize();
        expect(serialized.output_handler).toEqual({ type: "to_parent", parent_agent_id: "parent-456" });

        const templateRepo = new TemplateRepository();
        await templateRepo.add(template);

        const deserialized = await Agent.deserialize(serialized, templateRepo);
        expect(deserialized.id).toBe(agent.id);
        expect(deserialized.outputHandler).toBeInstanceOf(ToParentOutputHandler);
        expect((deserialized.outputHandler as ToParentOutputHandler).parent_agent_id).toBe("parent-456");
    });

    it("deserializes with AgentRepository.deserialize", async () => {
        const registry = new OutputHandlerRegistry();
        const userHandler = new UserOutputHandler("http", "chat-789");
        registry.register("http", "chat-789", userHandler);

        const template = makeTemplate();
        const agent1 = Agent.create(template, userHandler);
        const agent2 = Agent.create(template, new ToParentOutputHandler("parent-abc"));

        const repo = new AgentRepository();
        await repo.add(agent1);
        await repo.add(agent2);

        const serialized = repo.serialize();
        expect(serialized).toHaveLength(2);

        const templateRepo = new TemplateRepository();
        await templateRepo.add(template);

        const deserializedRepo = await AgentRepository.deserialize(serialized, templateRepo, registry);
        const deserialized1 = await deserializedRepo.getById(agent1.id);
        const deserialized2 = await deserializedRepo.getById(agent2.id);

        expect(deserialized1).not.toBeNull();
        expect(deserialized1!.outputHandler).toBe(userHandler);
        expect(deserialized2).not.toBeNull();
        expect(deserialized2!.outputHandler).toBeInstanceOf(ToParentOutputHandler);
    });
});
