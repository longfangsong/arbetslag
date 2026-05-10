import { z } from "zod";
import { Result, ok } from "neverthrow";
import { Context } from "../context";
import { Tool } from ".";

export const EmitEventInputSchema = z
  .object({
    eventType: z.string().describe("Event type to emit (e.g., 'user:action', 'system:alert')."),
    data: z.any().optional().describe("Event payload data."),
  })
  .describe("Emit an event that subscribed agents can react to.");

export class EmitEvent implements Tool<typeof EmitEventInputSchema, { eventType: string }> {
  static toolName: string = "emitEvent";
  description =
    "Emit an event. Agents subscribed to this event type will receive it in their mailbox. Use this to trigger workflows or notify other agents of state changes.";
  inputSchema = EmitEventInputSchema;

  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof EmitEventInputSchema>,
  ): Promise<Result<{ eventType: string }, string>> {
    await context.agentRunner.emitEvent(input.eventType, input.data);
    return ok({ eventType: input.eventType });
  }
}
