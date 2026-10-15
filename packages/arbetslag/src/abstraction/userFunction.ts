import { JsonValue } from "type-fest";

export interface UserFunction {
  readonly id: string;
  function: (input: JsonValue) => Promise<JsonValue>;
}