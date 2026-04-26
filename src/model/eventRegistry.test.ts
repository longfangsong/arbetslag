import { describe, it, expect, beforeEach } from "vitest";
import { EventRegistry } from "./eventRegistry";
import { InMemoryFileSystem } from "./fileSystem/inMemory";

describe("EventRegistry", () => {
  let registry: EventRegistry;
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    registry = new EventRegistry("data/events.json", fs);
  });

  it("registers a new event", async () => {
    await registry.register("evt-1", "session-1", "agent-1");
    const record = await registry.resolve("evt-1");
    expect(record).toBeDefined();
    expect(record!.sessionId).toBe("session-1");
    expect(record!.agentId).toBe("agent-1");
    expect(record!.registeredAt).toBeDefined();
  });

  it("overwrites an existing event", async () => {
    await registry.register("evt-1", "session-1", "agent-1");
    await registry.register("evt-1", "session-2", "agent-2");
    const record = await registry.resolve("evt-1");
    expect(record!.sessionId).toBe("session-2");
    expect(record!.agentId).toBe("agent-2");
  });

  it("returns undefined for non-existent event", async () => {
    const record = await registry.resolve("evt-999");
    expect(record).toBeUndefined();
  });

  it("marks an event as resolved and removes it", async () => {
    await registry.register("evt-1", "session-1", "agent-1");
    await registry.markResolved("evt-1");
    const record = await registry.resolve("evt-1");
    expect(record).toBeUndefined();
  });

  it("handles multiple events independently", async () => {
    await registry.register("evt-1", "session-1", "agent-1");
    await registry.register("evt-2", "session-2", "agent-2");
    await registry.register("evt-3", "session-3", "agent-3");

    expect((await registry.resolve("evt-1"))!.sessionId).toBe("session-1");
    expect((await registry.resolve("evt-2"))!.sessionId).toBe("session-2");
    expect((await registry.resolve("evt-3"))!.sessionId).toBe("session-3");
  });

  it("starts with empty registry if file does not exist", async () => {
    const record = await registry.resolve("evt-999");
    expect(record).toBeUndefined();
  });

  it("uses the injected FileSystem for persistence", async () => {
    await registry.register("evt-1", "session-1", "agent-1");
    const content = await fs.readFile("data/events.json");
    const parsed = JSON.parse(content);
    expect(parsed["evt-1"]).toBeDefined();
    expect(parsed["evt-1"].sessionId).toBe("session-1");
  });
});
