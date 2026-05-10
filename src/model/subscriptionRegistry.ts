import type { FileSystem } from "./fileSystem";
import { SUBSCRIPTIONS_FILE } from "./paths";

/**
 * Persistent type-based event subscriptions.
 *
 * When an agent subscribes to an event type, it will receive
 * messages in its mailbox whenever that event is emitted.
 *
 * Storage: data/subscriptions.json → { "eventType": ["agentId1", "agentId2"] }
 */
export class SubscriptionRegistry {
  constructor(private readonly fs: FileSystem) {}

  /** Register an agent as a subscriber to an event type. */
  async subscribe(eventType: string, agentId: string): Promise<void> {
    const records = await this.#load();
    if (!records[eventType]) {
      records[eventType] = [];
    }
    if (!records[eventType].includes(agentId)) {
      records[eventType].push(agentId);
    }
    await this.fs.writeFile(SUBSCRIPTIONS_FILE, JSON.stringify(records, null, 2));
  }

  /** Remove an agent's subscription to an event type. */
  async unsubscribe(eventType: string, agentId: string): Promise<void> {
    const records = await this.#load();
    const subscribers = records[eventType];
    if (!subscribers) return;
    const index = subscribers.indexOf(agentId);
    if (index !== -1) {
      subscribers.splice(index, 1);
    }
    if (subscribers.length === 0) {
      delete records[eventType];
    }
    await this.fs.writeFile(SUBSCRIPTIONS_FILE, JSON.stringify(records, null, 2));
  }

  /** Get all agents subscribed to an event type. */
  async getSubscribers(eventType: string): Promise<string[]> {
    const records = await this.#load();
    return records[eventType] ?? [];
  }

  async #load(): Promise<Record<string, string[]>> {
    try {
      const raw = await this.fs.readFile(SUBSCRIPTIONS_FILE);
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}
