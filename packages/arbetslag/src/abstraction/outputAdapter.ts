import type { JsonValue } from "type-fest";
import type { Sink } from "../messageBox";

/**
 * A pure exit point: results of the graph flow out to an external system.
 *
 * Nobody consumes its output, so it is not an `Actor` either. `send` returning a
 * promise *is* the backpressure signal; an implementation that wants to decouple
 * from the graph's loop composes an `Inbox` instead of inheriting a base class.
 *
 * `config` is what a project file needs to rebuild this node: the delivery target
 * lives in the file, not in a closure, so a persisted project is self-describing.
 */
export abstract class OutputAdapter implements Sink<JsonValue> {
	readonly kind = "output" as const;
	readonly config?: JsonValue;

	abstract send(payload: JsonValue): Promise<void>;
}
