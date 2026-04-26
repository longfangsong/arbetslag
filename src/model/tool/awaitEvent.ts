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
    "Wait for an external event to arrive. The agent exits and will be resumed when the event triggers createEventHandler.",
  ) satisfies z.ZodTypeAny;

export class AwaitEvent {
  static get name(): string {
    return "awaitEvent";
  }
  description =
    "Register an event ID and wait for an external system to trigger it. The agent will exit and resume when createEventHandler is called with the matching eventId. The external system should include the eventId in its callback payload.";
  inputSchema = AwaitEventInputSchema;

  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof AwaitEventInputSchema>,
  ): Promise<{ eventId: string; status: "registered" }> {
    const agentId = session.currentAgentId;
    if (!agentId) {
      throw new Error(
        "No agent context available — awaitEvent must be called within an agent's execution.",
      );
    }
    await context.eventRegistry.register(input.eventId, session.id, agentId);
    return { eventId: input.eventId, status: "registered" };
  }
}
