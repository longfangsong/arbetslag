import type { FileSystem } from "./fileSystem";
import { MAILBOX_FILE_PATTERN } from "./paths";

export interface MailboxMessage {
  content: string;
  eventType?: string;
  sourceAgentId?: string;
}

function mailboxPath(agentId: string): string {
  return MAILBOX_FILE_PATTERN.replace("{agentId}", agentId);
}

/**
 * Persistent per-agent message queue backed by FileSystem.
 *
 * In the actor model, each agent has a mailbox. External messages
 * are enqueued here. When an agent wakes up, it dequeues one message,
 * processes it, then sleeps again.
 *
 * Storage: mailbox/{agentId}.json → JSON array of messages.
 */
export class Mailbox {
  private readonly path: string;

  constructor(
    private readonly fs: FileSystem,
    private readonly agentId: string,
  ) {
    this.path = mailboxPath(agentId);
  }

  /** Add a message to the end of the queue. */
  async enqueue(message: MailboxMessage): Promise<void> {
    const messages = await this.#load();
    messages.push(message);
    await this.fs.writeFile(this.path, JSON.stringify(messages, null, 2));
  }

  /** Remove and return the first message in the queue. */
  async dequeue(): Promise<MailboxMessage | null> {
    const messages = await this.#load();
    if (messages.length === 0) return null;
    const message = messages.shift()!;
    await this.fs.writeFile(this.path, JSON.stringify(messages, null, 2));
    return message;
  }

  /** Check if the mailbox is empty. */
  async isEmpty(): Promise<boolean> {
    const messages = await this.#load();
    return messages.length === 0;
  }

  /** Peek at the first message without removing it. */
  async peek(): Promise<MailboxMessage | null> {
    const messages = await this.#load();
    return messages[0] ?? null;
  }

  /** Get the number of messages in the mailbox. */
  async length(): Promise<number> {
    const messages = await this.#load();
    return messages.length;
  }

  async #load(): Promise<MailboxMessage[]> {
    try {
      const raw = await this.fs.readFile(this.path);
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}
