import { describe, it, expect, beforeEach } from "vitest";
import { FileSystemAgentRepository } from "./repository";
import { InMemoryFileSystem } from "@/implementation/filesystem/inMemory";
import { Agent } from "@/application/agent/model";
import { Template } from "@/application/agent/template/model";

describe("FileSystemAgentRepository", () => {
  let fs: InMemoryFileSystem;
  let repo: FileSystemAgentRepository;

  const sampleTemplate: Template = {
    name: "test",
    description: "A test template",
    ai_provider: "openai",
    model: "gpt-4",
    systemPrompt: "You are a test agent.",
    allowedTools: [],
  };

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    repo = new FileSystemAgentRepository(fs, "agents");
  });

  it("adds and retrieves an agent by id", async () => {
    const agent = Agent.create(sampleTemplate);
    const result = await repo.add(agent);
    const retrieved = await repo.getById(agent.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(agent.id);
    expect(retrieved!.template).toEqual(sampleTemplate);
    expect(retrieved!.history).toEqual([]);
    expect(result).toBe(agent);
  });

  it("returns null for non-existent agent", async () => {
    const result = await repo.getById("nonexistent");
    expect(result).toBeNull();
  });

  it("lists all added agents", async () => {
    const agent = Agent.create(sampleTemplate);
    await repo.add(agent);
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(agent.id);
  });

  it("returns empty list when no agents exist", async () => {
    const list = await repo.list();
    expect(list).toHaveLength(0);
  });

  it("stores multiple agents and lists them all", async () => {
    const agent1 = Agent.create(sampleTemplate);
    const agent2 = Agent.create(sampleTemplate);
    await repo.add(agent1);
    await repo.add(agent2);
    const list = await repo.list();
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.id)).toEqual([agent1.id, agent2.id]);
  });

  it("persists agent history", async () => {
    const agent = Agent.create(sampleTemplate);
    agent.history.push({ role: "user", content: "Hello" });
    await repo.add(agent);
    const retrieved = await repo.getById(agent.id);
    expect(retrieved!.history).toHaveLength(1);
    expect(retrieved!.history[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("persists agent with custom directory", async () => {
    const customFs = new InMemoryFileSystem();
    const customRepo = new FileSystemAgentRepository(customFs, "custom/path");
    const agent = Agent.create(sampleTemplate);
    await customRepo.add(agent);
    const retrieved = await customRepo.getById(agent.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(agent.id);
  });

  it("sets and retrieves chatId on agent", async () => {
    const agent = Agent.create(sampleTemplate);
    agent.chatId = "chat-123";
    await repo.add(agent);
    const retrieved = await repo.getById(agent.id);
    expect(retrieved!.chatId).toBe("chat-123");
  });

  it("getChatIdByAgentId returns chatId for mapped agent", async () => {
    const agent = Agent.create(sampleTemplate);
    const chatId = "chat-456";
    await repo.setEntryAgent(chatId, agent);
    const result = await repo.getChatIdByAgentId(agent.id);
    expect(result).toBe(chatId);
  });

  it("getChatIdByAgentId returns undefined for unmapped agent", async () => {
    const agent = Agent.create(sampleTemplate);
    const result = await repo.getChatIdByAgentId(agent.id);
    expect(result).toBeUndefined();
  });
});
