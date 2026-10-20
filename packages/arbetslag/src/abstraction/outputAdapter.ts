import type { JsonValue } from "type-fest";
import type { Sink } from "../messageBox";
import { nanoid } from "../utils";

/**
 * A pure exit point: results of the graph flow out to an external system.
 *
 * Nobody consumes its output, so it is not an `Actor` either. `send` returning a
 * promise *is* the backpressure signal; an implementation that wants to decouple
 * from the graph's loop composes an `Inbox` instead of inheriting a base class.
 *
 * The id is minted here, once per instance: two outputs of the same class in one
 * project are two distinct nodes, and subclasses must not declare their own.
 */
export abstract class OutputAdapter implements Sink<JsonValue> {
	readonly kind = "output" as const;
	readonly id: string = nanoid();

	abstract send(payload: JsonValue): Promise<void>;
}
