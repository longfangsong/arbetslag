import z from "zod";
import { Context } from "../context";
import { Session } from "../session";

export const AwaitEventInputSchema = z
  .object({
    eventId: z
      .string()
      .describe("Unique identifier for the external event to wait for."),
  })
  .describe(
    "Wait for an external event to arrive. This tool blocks the agent until the event is triggered by an external system (e.g., a cron job callback). The agent will not proceed until the event arrives or the timeout (default 60s) is reached.",
  ) satisfies z.ZodTypeAny;

export class AwaitEvent {
  static name = "awaitEvent";
  description =
    "Blocks the agent until an external event is triggered. Polls for up to 60s. Returns the event data when the external system (e.g., cron-job.org webhook) fires. Use this after createCronJob to wait for the callback.";
  inputSchema = AwaitEventInputSchema;

  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof AwaitEventInputSchema>,
  ): Promise<{ eventId: string; status: "resolved"; data: unknown }> {
    const agentId = session.currentAgentId;
    if (!agentId) {
      throw new Error(
        "No agent context available — awaitEvent must be called within an agent's execution.",
      );
    }

    // Register the event so external systems can target it
    await context.eventRegistry.register(input.eventId, session.id, agentId);

    // Poll for the event to be resolved (triggered by external callback via handleEvent)
    const timeoutMs = 60_000 * 60; // 60 second default timeout
    const pollIntervalMs = 500;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const record = await context.eventRegistry.resolve(input.eventId);
      if (record?.resolvedAt && record.data !== undefined) {
        // Event has been resolved with data — consume it and return
        await context.eventRegistry.markResolved(input.eventId);
        return {
          eventId: input.eventId,
          status: "resolved",
          data: record.data,
        };
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(
      `Event '${input.eventId}' did not arrive within ${timeoutMs / 1000}s timeout.`,
    );
  }
}
