import type { JsonValue } from "type-fest";
import { Outbox, type Source } from "../messageBox";
import { nanoid } from "../utils";

/**
 * A pure entry point: requests from an external system flow into the graph.
 *
 * Nothing in the graph ever sends to an input, so it is not an `Actor` — there
 * is no inbound queue and no `process` step, only an outbound stream.
 *
 * The id is minted here, once per instance: two inputs of the same class in one
 * project are two distinct nodes, and subclasses must not declare their own.
 */
export abstract class InputAdapter implements Source<JsonValue> {
	readonly kind = "input" as const;
	readonly id: string = nanoid();

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
