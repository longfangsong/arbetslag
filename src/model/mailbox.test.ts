import { describe, it, expect } from "vitest";
import { InMemoryFileSystem } from "./fileSystem/inMemory";
import { Mailbox, MailboxMessage } from "./mailbox";

function createMailbox(): { mailbox: Mailbox; fs: InMemoryFileSystem } {
  const fs = new InMemoryFileSystem();
  const mailbox = new Mailbox(fs, "test-agent-1");
  return { mailbox, fs };
}

describe("Mailbox", () => {
  it("starts empty", async () => {
    const { mailbox } = createMailbox();
    expect(await mailbox.isEmpty()).toBe(true);
    expect(await mailbox.length()).toBe(0);
    expect(await mailbox.peek()).toBeNull();
    expect(await mailbox.dequeue()).toBeNull();
  });

  it("enqueues and dequeues a message", async () => {
    const { mailbox } = createMailbox();
    const msg: MailboxMessage = { content: "Hello" };
    await mailbox.enqueue(msg);

    expect(await mailbox.isEmpty()).toBe(false);
    expect(await mailbox.length()).toBe(1);
    expect(await mailbox.peek()).toEqual(msg);

    const result = await mailbox.dequeue();
    expect(result).toEqual(msg);
    expect(await mailbox.isEmpty()).toBe(true);
    expect(await mailbox.length()).toBe(0);
  });

  it("dequeues in FIFO order", async () => {
    const { mailbox } = createMailbox();
    await mailbox.enqueue({ content: "First" });
    await mailbox.enqueue({ content: "Second" });
    await mailbox.enqueue({ content: "Third" });

    const d1 = await mailbox.dequeue();
    expect(d1?.content).toBe("First");
    const d2 = await mailbox.dequeue();
    expect(d2?.content).toBe("Second");
    const d3 = await mailbox.dequeue();
    expect(d3?.content).toBe("Third");
    expect(await mailbox.dequeue()).toBeNull();
  });

  it("persists messages across loads", async () => {
    const fs = new InMemoryFileSystem();
    const mailbox1 = new Mailbox(fs, "test-agent-1");
    await mailbox1.enqueue({ content: "Persisted" });

    // Simulate reload from disk
    const mailbox2 = new Mailbox(fs, "test-agent-1");
    expect(await mailbox2.isEmpty()).toBe(false);
    const persisted = await mailbox2.dequeue();
    expect(persisted?.content).toBe("Persisted");
  });

  it("stores metadata fields", async () => {
    const { mailbox } = createMailbox();
    const msg: MailboxMessage = {
      content: "Event data",
      eventType: "user:message",
      sourceAgentId: "agent-abc",
    };
    await mailbox.enqueue(msg);

    const result = await mailbox.dequeue();
    expect(result).toEqual(msg);
  });
});
