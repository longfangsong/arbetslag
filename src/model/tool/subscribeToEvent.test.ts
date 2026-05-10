import { describe, it, expect, beforeEach } from "vitest";
import { createRuntime, type Context } from "../context";
import { InMemoryAgentRepository } from "../agentRepository";
import { InMemoryFileSystem } from "../fileSystem/inMemory";
import { SubscribeToEvent } from "./subscribeToEvent";
import { SubscriptionRegistry } from "../subscriptionRegistry";

describe("SubscribeToEvent", () => {
  let context: Context;
  let tool: SubscribeToEvent;
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    const runtime = createRuntime(
      [], [], fs, [], {},
      new InMemoryAgentRepository(),
    );
    context = runtime.context;
    tool = new SubscribeToEvent();
  });

  it("should have correct name", () => {
    expect(SubscribeToEvent.toolName).toBe("subscribeToEvent");
    expect(tool.description).toContain("Subscribe to an event type");
  });

  it("subscribes to an event type", async () => {
    const result = await tool.handler(context, "agent-1", {
      eventType: "test:event",
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().eventType).toBe("test:event");
    expect(result._unsafeUnwrap().subscriptionId).toMatch(/^sub-/);
  });

  it("persists subscriptions to file system", async () => {
    await tool.handler(context, "agent-1", {
      eventType: "test:event",
    });

    const raw = await fs.readFile("data/subscriptions.json");
    const subscriptions = JSON.parse(raw);
    expect(subscriptions["test:event"]).toContain("agent-1");
  });

  it("creates unique subscription IDs", async () => {
    const result1 = await tool.handler(context, "agent-1", {
      eventType: "test:event",
    });
    const result2 = await tool.handler(context, "agent-1", {
      eventType: "test:event",
    });

    expect(result1._unsafeUnwrap().subscriptionId).not.toBe(result2._unsafeUnwrap().subscriptionId);
  });

  it("supports multiple subscriptions for same event type", async () => {
    await tool.handler(context, "agent-1", {
      eventType: "test:event",
    });
    await tool.handler(context, "agent-2", {
      eventType: "test:event",
    });

    const registry = new SubscriptionRegistry(fs);
    const subscribers = await registry.getSubscribers("test:event");
    expect(subscribers).toContain("agent-1");
    expect(subscribers).toContain("agent-2");
  });

  it("does not duplicate subscriptions for same agent", async () => {
    await tool.handler(context, "agent-1", {
      eventType: "test:event",
    });
    await tool.handler(context, "agent-1", {
      eventType: "test:event",
    });

    const registry = new SubscriptionRegistry(fs);
    const subscribers = await registry.getSubscribers("test:event");
    expect(subscribers).toEqual(["agent-1"]);
  });
});
