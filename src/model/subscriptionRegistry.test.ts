import { describe, it, expect } from "vitest";
import { InMemoryFileSystem } from "./fileSystem/inMemory";
import { SubscriptionRegistry } from "./subscriptionRegistry";

function createRegistry(): { registry: SubscriptionRegistry; fs: InMemoryFileSystem } {
  const fs = new InMemoryFileSystem();
  const registry = new SubscriptionRegistry(fs);
  return { registry, fs };
}

describe("SubscriptionRegistry", () => {
  it("starts with no subscribers", async () => {
    const { registry } = createRegistry();
    expect(await registry.getSubscribers("user:message")).toEqual([]);
  });

  it("subscribes and retrieves subscribers", async () => {
    const { registry } = createRegistry();
    await registry.subscribe("user:message", "agent-1");
    await registry.subscribe("user:message", "agent-2");

    expect(await registry.getSubscribers("user:message")).toEqual(["agent-1", "agent-2"]);
  });

  it("does not duplicate subscribers", async () => {
    const { registry } = createRegistry();
    await registry.subscribe("user:message", "agent-1");
    await registry.subscribe("user:message", "agent-1");

    expect(await registry.getSubscribers("user:message")).toEqual(["agent-1"]);
  });

  it("unsubscribes an agent", async () => {
    const { registry } = createRegistry();
    await registry.subscribe("user:message", "agent-1");
    await registry.subscribe("user:message", "agent-2");

    await registry.unsubscribe("user:message", "agent-1");
    expect(await registry.getSubscribers("user:message")).toEqual(["agent-2"]);
  });

  it("cleans up event type when all subscribers leave", async () => {
    const { registry } = createRegistry();
    await registry.subscribe("user:message", "agent-1");
    await registry.unsubscribe("user:message", "agent-1");

    expect(await registry.getSubscribers("user:message")).toEqual([]);
  });

  it("persists across loads", async () => {
    const fs = new InMemoryFileSystem();
    const registry1 = new SubscriptionRegistry(fs);
    await registry1.subscribe("user:message", "agent-1");

    const registry2 = new SubscriptionRegistry(fs);
    expect(await registry2.getSubscribers("user:message")).toEqual(["agent-1"]);
  });
});
