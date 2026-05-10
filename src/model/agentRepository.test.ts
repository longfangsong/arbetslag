import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryAgentRepository,
  FileAgentRepository,
} from "./agentRepository";
import { InMemoryFileSystem } from "./fileSystem/inMemory";
import { createRuntime, type Context } from "./context";

import type { Template } from "./agent";
import { MockLLMAdapter, mockToolCtor } from "./agentRepository.test.helpers";

const testTemplate: Template = {
  name: "test-agent",
  description: "Test agent for repository tests",
  provider: "mock",
  model: "mock-model",
  systemPrompt: "You are a test agent.",
  tools: [{ name: "mockTool" }],
};

describe("InMemoryAgentRepository", () => {
  let repo: InMemoryAgentRepository;
  let context: Context;
  let fs: InMemoryFileSystem;
  let adapter: MockLLMAdapter;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    adapter = new MockLLMAdapter("mock");
    repo = new InMemoryAgentRepository();
    const runtime = createRuntime(
      [adapter],
      [mockToolCtor],
      fs,
      [testTemplate],
      {},
      repo,
    );
    context = runtime.context;
  });

  it("creates and saves an agent", async () => {
    const agent = await repo.create(testTemplate, context);

    expect(agent).toBeDefined();
    expect(agent.id).toBeDefined();
    expect(agent.model).toBe("mock-model");
    expect(agent.systemPrompt).toBe("You are a test agent.");
    expect(agent.toolNames).toEqual(["mockTool"]);
    expect(agent.tools.length).toBe(1);
  });

  it("loads an agent by ID", async () => {
    const agent = await repo.create(testTemplate, context);
    const loaded = await repo.load(agent.id, context);

    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(agent.id);
    expect(loaded!.model).toBe(agent.model);
    expect(loaded!.systemPrompt).toBe(agent.systemPrompt);
  });

  it("returns null for non-existent agent", async () => {
    const loaded = await repo.load("non-existent", context);
    expect(loaded).toBeNull();
  });

  it("persists history across save/load", async () => {
    const agent = await repo.create(testTemplate, context);

    // Simulate conversation history
    agent.history = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    await repo.save(agent);

    const loaded = await repo.load(agent.id, context);
    expect(loaded!.history).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ]);
  });

  it("loadState returns raw state without reconstructing", async () => {
    const agent = await repo.create(testTemplate, context);
    agent.history = [{ role: "user", content: "test" }];
    await repo.save(agent);

    const json = await repo.loadState(agent.id);
    expect(json).toBeDefined();
    const state = JSON.parse(json!);
    expect(state.id).toBe(agent.id);
    expect(state.adapter).toBe("mock");
    expect(state.history).toEqual([{ role: "user", content: "test" }]);
  });
});

describe("FileAgentRepository", () => {
  let repo: FileAgentRepository;
  let context: Context;
  let fs: InMemoryFileSystem;
  let adapter: MockLLMAdapter;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    adapter = new MockLLMAdapter("mock");
    const fileRepo = new FileAgentRepository(fs);
    const runtime = createRuntime(
      [adapter],
      [mockToolCtor],
      fs,
      [testTemplate],
      {},
      fileRepo,
    );
    context = runtime.context;
    repo = fileRepo;
  });

  it("creates and saves an agent to disk", async () => {
    const agent = await repo.create(testTemplate, context);

    expect(agent).toBeDefined();
    expect(agent.id).toBeDefined();

    // Verify file was written
    const json = await repo.loadState(agent.id);
    expect(json).toBeDefined();
    const state = JSON.parse(json!);
    expect(state.id).toBe(agent.id);
    expect(state.model).toBe("mock-model");
  });

  it("loads raw state from disk", async () => {
    const agent = await repo.create(testTemplate, context);
    agent.history = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];
    await repo.save(agent);

    const json = await repo.loadState(agent.id);
    expect(json).toBeDefined();
    const state = JSON.parse(json!);
    expect(state.history).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);
    expect(state.adapter).toBe("mock");
  });

  it("returns null for non-existent agent state", async () => {
    const state = await repo.loadState("non-existent");
    expect(state).toBeNull();
  });

  it("loads an agent from disk via load()", async () => {
    const agent = await repo.create(testTemplate, context);
    agent.history = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ];
    await repo.save(agent);

    const loaded = await repo.load(agent.id, context);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(agent.id);
    expect(loaded!.model).toBe(agent.model);
    expect(loaded!.systemPrompt).toBe(agent.systemPrompt);
  });

  it("persists and restores via load()", async () => {
    const agent = await repo.create(testTemplate, context);

    // Simulate conversation
    agent.history = [
      { role: "user", content: "What is the weather?" },
      { role: "assistant", content: "Sunny, 22°C" },
    ];
    await repo.save(agent);

    // Load and reconstruct via repository
    const restored = await repo.load(agent.id, context);

    expect(restored!.id).toBe(agent.id);
    expect(restored!.model).toBe(agent.model);
    expect(restored!.systemPrompt).toBe(agent.systemPrompt);
    expect(restored!.toolNames).toEqual(["mockTool"]);
    expect(restored!.history).toEqual([
      { role: "user", content: "What is the weather?" },
      { role: "assistant", content: "Sunny, 22°C" },
    ]);
  });
});
