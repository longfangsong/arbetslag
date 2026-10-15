import { JsonValue } from "type-fest";
import { Actor } from "../actor";

export abstract class UserFunction extends Actor<JsonValue, JsonValue> {
  abstract function: (input: JsonValue) => Promise<JsonValue>;
  
  protected async process(input: JsonValue): Promise<void> {
    const result = await this.function(input);
    await this.outputChannel.send(result);
  }
}