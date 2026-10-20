import type { JsonValue } from "type-fest";
import { Outbox, type Source } from "../messageBox";

/**
 * A pure entry point: requests from an external system flow into the graph.
 *
 * Nothing in the graph ever sends to an input, so it is not an `Actor` — there
 * is no inbound queue and no `process` step, only an outbound stream.
 *
 * `config` is what a project file needs to rebuild this node; it carries the
 * constructor arguments that are data. Anything else (an open server, a client)
 * is supplied by whoever registers the class with the `Runtime`.
 */
export abstract class InputAdapter implements Source<JsonValue> {
	readonly kind = "input" as const;
	readonly config?: JsonValue;

	private readonly outbox: Outbox<JsonValue> = new Outbox<JsonValue>();

	[Symbol.asyncIterator](): AsyncIterator<JsonValue> {
		return this.outbox[Symbol.asyncIterator]();
	}

	async stop(): Promise<void> {
		this.outbox.close();
	}

	/**
	 * Transport-edge entry (HTTP, websocket, timer): put a payload on the outbox.
	 * Not part of the `Source` contract, because the graph never calls it.
	 */
	accept(payload: JsonValue): Promise<void> {
		return this.outbox.push(payload);
	}
}
