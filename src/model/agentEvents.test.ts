import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryFileSystem } from "./fileSystem/inMemory";
import { SubscriptionRegistry } from "./subscriptionRegistry";

describe("Agent event subscription (mailbox-based)", () => {
  let fs: InMemoryFileSystem;
  let registry: SubscriptionRegistry;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    registry = new SubscriptionRegistry(fs);
  });

  it("subscribes an agent to an event type", async () => {
    await registry.subscribe("user:message", "agent-1");

    const subscribers = await registry.getSubscribers("user:message");
    expect(subscribers).toEqual(["agent-1"]);
  });

  it("subscribes multiple agents to the same event type", async () => {
    await registry.subscribe("user:message", "agent-1");
    await registry.subscribe("user:message", "agent-2");

    const subscribers = await registry.getSubscribers("user:message");
    expect(subscribers).toEqual(["agent-1", "agent-2"]);
  });

  it("does not duplicate subscribers", async () => {
    await registry.subscribe("user:message", "agent-1");
    await registry.subscribe("user:message", "agent-1");

    const subscribers = await registry.getSubscribers("user:message");
    expect(subscribers).toEqual(["agent-1"]);
  });

  it("unsubscribes an agent from an event type", async () => {
    await registry.subscribe("user:message", "agent-1");
    await registry.subscribe("user:message", "agent-2");

    await registry.unsubscribe("user:message", "agent-1");

    const subscribers = await registry.getSubscribers("user:message");
    expect(subscribers).toEqual(["agent-2"]);
  });

  it("persists subscriptions across loads", async () => {
    const registry1 = new SubscriptionRegistry(fs);
    await registry1.subscribe("user:message", "agent-1");

    const registry2 = new SubscriptionRegistry(fs);
    const subscribers = await registry2.getSubscribers("user:message");
    expect(subscribers).toEqual(["agent-1"]);
  });

  it("handles different event types independently", async () => {
    await registry.subscribe("user:message", "agent-1");
    await registry.subscribe("system:alert", "agent-2");

    const msgSubscribers = await registry.getSubscribers("user:message");
    const alertSubscribers = await registry.getSubscribers("system:alert");

    expect(msgSubscribers).toEqual(["agent-1"]);
    expect(alertSubscribers).toEqual(["agent-2"]);
  });
});
