import type { JsonValue } from "type-fest";
import z from "zod";
import type { Context } from "..";
import { newId } from "../utils";

export const schema = z.object({
  id: z.string().min(1),
  triggerName: z.string().min(1),
  config: z.json() as z.ZodType<JsonValue>,
});

export class TriggerSubscription {
  id: string;
  triggerName: string;
  config: JsonValue;

  constructor(id: string, triggerName: string, config: JsonValue) {
    this.id = id;
    this.triggerName = triggerName;
    this.config = config;
  }

  static create(
    context: Context,
    triggerName: string,
    config: JsonValue,
  ): TriggerSubscription {
    const triggerDefinition = context.triggerRepository.get(triggerName);
    if (!triggerDefinition) {
      throw new Error(`Trigger definition ${triggerName} not found`);
    }
    return new TriggerSubscription(
      newId(),
      triggerName,
      triggerDefinition.configSchema.parse(config),
    );
  }

  static deserialize(data: z.infer<typeof schema>): TriggerSubscription {
    return new TriggerSubscription(data.id, data.triggerName, data.config);
  }

  serialize(): z.infer<typeof schema> {
    return {
      id: this.id,
      triggerName: this.triggerName,
      config: this.config,
    };
  }
}
