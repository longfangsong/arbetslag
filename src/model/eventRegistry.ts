import { z } from "zod";
import { FileSystem } from "./fileSystem";

export const EventRecordSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  registeredAt: z.string(),
  resolvedAt: z.string().optional(),
  data: z.unknown().optional(),
});

export type EventRecord = z.infer<typeof EventRecordSchema>;

export class EventRegistry {
  private readonly path: string;
  private readonly fs: FileSystem;

  constructor(path: string, fs: FileSystem) {
    this.path = path;
    this.fs = fs;
  }

  /**
   * Register an event. Overwrites if eventId already exists.
   */
  async register(
    eventId: string,
    sessionId: string,
    agentId: string,
  ): Promise<void> {
    const records = await this.#load();
    records[eventId] = {
      sessionId,
      agentId,
      registeredAt: new Date().toISOString(),
    };
    await this.#save(records);
  }

  /**
   * Resolve an event by its ID. Returns undefined if not found or already resolved.
   */
  async resolve(eventId: string): Promise<EventRecord | undefined> {
    const records = await this.#load();
    return records[eventId];
  }

  /**
   * Mark an event as resolved by removing it from the registry.
   */
  async markResolved(eventId: string): Promise<void> {
    const records = await this.#load();
    delete records[eventId];
    await this.#save(records);
  }

  /**
   * Store event data and mark as resolved. Used by handleEvent to persist
   * the callback payload so awaitEvent can read it.
   */
  async storeResolved(
    eventId: string,
    data: unknown,
  ): Promise<void> {
    const records = await this.#load();
    const record = records[eventId];
    if (!record) return; // Event was already consumed by awaitEvent
    record.resolvedAt = new Date().toISOString();
    record.data = data;
    await this.#save(records);
  }

  /**
   * Check if an event record still exists (hasn't been consumed).
   */
  async exists(eventId: string): Promise<boolean> {
    const records = await this.#load();
    return !!records[eventId];
  }

  async #load(): Promise<Record<string, EventRecord>> {
    try {
      const raw = await this.fs.readFile(this.path);
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async #save(records: Record<string, EventRecord>): Promise<void> {
    await this.fs.writeFile(this.path, JSON.stringify(records, null, 2));
  }
}
