import { Agent } from "./agent";
import { Context } from "./context";

/**
 * Resumes a paused agent when an external event arrives.
 *
 * The handler:
 * 1. Extracts `eventId` from the incoming payload
 * 2. Resolves `sessionId` + `agentId` from EventRegistry
 * 3. Marks the event as resolved (prevents double-processing)
 * 4. Loads agent state from disk and resumes the loop
 *
 * Transport-agnostic — HTTP, queues, cron, file watcher, whatever.
 * The caller is responsible for constructing a fresh `Context` per invocation.
 *
 * @example
 * ```ts
 * // In your HTTP handler:
 * app.post("/webhook", async (req, res) => {
 *   const context = buildMyContext();
 *   const result = await handleEvent(context, req.body);
 *   res.send(result);
 * });
 * ```
 */
export async function handleEvent(
  context: Context,
  payload: unknown,
): Promise<string> {
  const eventRegistry = context.eventRegistry;

  // Extract eventId from payload
  const eventId =
    (payload as { eventId?: string })?.eventId ??
    ((payload as Record<string, unknown>)?.eventId as string | undefined);

  if (!eventId) {
    throw new Error("Missing eventId in payload");
  }

  // Resolve event to get sessionId + agentId
  const eventRecord = await eventRegistry.resolve(eventId);
  if (!eventRecord) {
    throw new Error(`Event '${eventId}' not found in registry`);
  }

  // Store event data so awaitEvent can read it (if blocking).
  // If awaitEvent is polling, it will consume the data and delete the record.
  // If the record is gone, awaitEvent already handled it — don't resume.
  await eventRegistry.storeResolved(eventId, payload);

  // Check if awaitEvent already consumed the event (blocking path)
  const stillExists = await eventRegistry.exists(eventId);
  if (!stillExists) {
    return `Event '${eventId}' was handled by a blocking awaitEvent.`;
  }

  // Non-blocking path: resume agent from disk with the event data
  const statePath = `run/${eventRecord.sessionId}/${eventRecord.agentId}.json`;
  const eventMessage =
    (payload as { data?: unknown })?.data ??
    (payload as Record<string, unknown>)?.data ??
    payload;

  return Agent.resumeFromFile(context, statePath, eventMessage);
}
