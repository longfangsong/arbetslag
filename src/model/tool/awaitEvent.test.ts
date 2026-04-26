import { describe, it, expect, beforeEach } from "vitest";
import { AwaitEvent } from "./awaitEvent";
import { InMemoryFileSystem } from "../fileSystem/inMemory";
import { EventRegistry } from "../eventRegistry";
import { Context } from "../context";
import { Session } from "../session";

describe("AwaitEvent", () => {
  let tool: AwaitEvent;
  let fs: InMemoryFileSystem;
  let registry: EventRegistry;
  let session: Session;
  let context: Context;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    registry = new EventRegistry("data/events.json", fs);
    session = new Session({ prompt: "test" });
    session.currentAgentId = "agent-123";
    context = new Context([], [], fs, [], {}, registry);
    tool = new AwaitEvent();
  });

  it("registers the event in the EventRegistry", async () => {
    const result = await tool.handler(context as any, session, {
      eventId: "evt-1",
    });

    expect(result).toEqual({ eventId: "evt-1", status: "registered" });

    const registry = new EventRegistry("data/events.json", fs);
    const record = await registry.resolve("evt-1");
    expect(record).toBeDefined();
    expect(record!.sessionId).toBe(session.id);
    expect(record!.agentId).toBe("agent-123");
  });

  it("uses the context's EventRegistry", async () => {
    await tool.handler(context, session, { eventId: "evt-2" });

    const record = await registry.resolve("evt-2");
    expect(record).toBeDefined();
  });

  it("rejects if no agent context is available", async () => {
    const sessionNoAgent = new Session({ prompt: "test" });
    // currentAgentId is null by default

    await expect(
      tool.handler(context as any, sessionNoAgent, { eventId: "evt-3" }),
    ).rejects.toThrow("No agent context available");
  });

  it("accepts and ignores the timeout parameter", async () => {
    const result = await tool.handler(context, session, {
      eventId: "evt-4",
    });

    expect(result).toEqual({ eventId: "evt-4", status: "registered" });
  });
});
