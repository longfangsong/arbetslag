import { z } from "zod";
import { nanoid } from "nanoid";
import { Result } from "neverthrow";
import { Context } from "../context";
import { Tool, ok, err } from ".";
import { SubscriptionRegistry } from "../subscriptionRegistry";

export const SubscribeToEventInputSchema = z
  .object({
    eventType: z.string().describe("Event type to subscribe to (e.g., 'user:action', 'system:alert')."),
  })
  .describe("Subscribe to an event type so the agent can react when events are emitted.");

export class SubscribeToEvent implements Tool<typeof SubscribeToEventInputSchema, {
  subscriptionId: string;
  eventType: string;
}> {
  static toolName: string = "subscribeToEvent";
  description =
    "Subscribe to an event type. When an event of this type is emitted, the agent will receive the event data in its mailbox. Returns a subscription ID.";
  inputSchema = SubscribeToEventInputSchema;

  async handler(
    context: Context,
    agentId: string,
    input: z.infer<typeof SubscribeToEventInputSchema>,
  ): Promise<Result<{ subscriptionId: string; eventType: string }, string>> {
    const subscriptionId = `sub-${nanoid(8)}`;

    // Register with subscription registry for persistence
    const registry = new SubscriptionRegistry(context.fileSystem);
    await registry.subscribe(input.eventType, agentId);

    return ok({ subscriptionId, eventType: input.eventType });
  }
}
