import type { JsonValue } from "type-fest";
import { Actor } from "../actor";

/**
 * A plain function wired into the graph.
 *
 * `config` is what a project file needs to rebuild this node — anything the
 * function needs that is data rather than code. Two instances of one class are
 * two separate nodes; what tells them apart is their position in the project,
 * not a name either of them carries.
 */
export abstract class UserFunction extends Actor<JsonValue, JsonValue> {
  readonly kind = "userFunction" as const;
  readonly config?: JsonValue;

  abstract function: (input: JsonValue) => Promise<JsonValue>;

  protected async process(input: JsonValue): Promise<ReadonlyArray<JsonValue>> {
    return [await this.function(input)];
  }
}
