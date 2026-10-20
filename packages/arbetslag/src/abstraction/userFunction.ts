import type { JsonValue } from "type-fest";
import { Actor } from "../actor";
import { nanoid } from "../utils";

/**
 * A plain function wired into the graph.
 *
 * The id is minted here, once per instance: two functions of the same class in
 * one project are two distinct nodes, and subclasses must not declare their own.
 */
export abstract class UserFunction extends Actor<JsonValue, JsonValue> {
  readonly kind = "userFunction" as const;
  readonly id: string = nanoid();

  abstract function: (input: JsonValue) => Promise<JsonValue>;

  protected async process(input: JsonValue): Promise<ReadonlyArray<JsonValue>> {
    return [await this.function(input)];
  }
}
