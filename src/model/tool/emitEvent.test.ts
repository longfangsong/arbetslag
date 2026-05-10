import { describe, it, expect, beforeEach } from "vitest";
import { createRuntime, type Context } from "../context";
import { InMemoryAgentRepository } from "../agentRepository";
import { InMemoryFileSystem } from "../fileSystem/inMemory";
import { ok } from "../tool";
import { EmitEvent } from "./emitEvent";
import { SubscriptionRegistry } from "../subscriptionRegistry";

describe("EmitEvent", () => {
  let context: Context;
  let tool: EmitEvent;
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    const runtime = createRuntime(
      [], [], fs, [], {},
      new InMemoryAgentRepository(),
    );
    context = runtime.context;
    tool = new EmitEvent();
  });

  it("should have correct name and schema", () => {
    expect(EmitEvent.toolName).toBe("emitEvent");
    expect(tool.description).toContain("Emit an event");
  });

  it("emits an event to subscribed agent", async () => {
    const reg = new SubscriptionRegistry(fs);
    await reg.subscribe("test:event", "agent-1");

    const result = await tool.handler(context, "agent-1", {
      eventType: "test:event",
      data: { message: "hello" },
    });

    expect(result).toEqual(ok({ eventType: "test:event" }));

    // Check mailbox
    const mailboxContent = await fs.readFile("mailbox/agent-1.json");
    const messages = JSON.parse(mailboxContent) as Array<{ content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('{"message":"hello"}');
  });

  it("emits an event without data", async () => {
    const reg = new SubscriptionRegistry(fs);
    await reg.subscribe("test:event", "agent-1");

    const result = await tool.handler(context, "agent-1", {
      eventType: "test:event",
    });

    expect(result).toEqual(ok({ eventType: "test:event" }));

    const mailboxContent = await fs.readFile("mailbox/agent-1.json");
    const messages = JSON.parse(mailboxContent) as Array<{ content: unknown }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe(undefined);
  });

  it("emits to multiple subscribers", async () => {
    const reg = new SubscriptionRegistry(fs);
    await reg.subscribe("multi:event", "agent-1");
    await reg.subscribe("multi:event", "agent-2");

    const result = await tool.handler(context, "agent-1", {
      eventType: "multi:event",
      data: { value: 42 },
    });

    expect(result).toEqual(ok({ eventType: "multi:event" }));

    // Check both mailboxes
    const msg1 = JSON.parse(await fs.readFile("mailbox/agent-1.json")) as Array<{ content: string }>;
    const msg2 = JSON.parse(await fs.readFile("mailbox/agent-2.json")) as Array<{ content: string }>;
    expect(msg1).toHaveLength(1);
    expect(msg2).toHaveLength(1);
    expect(msg1[0].content).toBe('{"value":42}');
    expect(msg2[0].content).toBe('{"value":42}');
  });

  it("does nothing when no subscribers", async () => {
    const result = await tool.handler(context, "agent-1", {
      eventType: "no:subscribers",
    });

    expect(result).toEqual(ok({ eventType: "no:subscribers" }));
  });
});
