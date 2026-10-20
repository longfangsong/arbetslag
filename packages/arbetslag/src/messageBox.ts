import { Chan } from "ts-chan";

/**
 * The reusable plumbing of the graph, with no notion of actors, adapters or
 * direction. Everything that used to be inherited from `Actor` lives here as a
 * plain class, so nodes compose the half they need instead of inheriting both.
 */

/** Anything the graph can push a message into. */
export interface Sink<I> {
	readonly id: string;
	send(input: I): Promise<void>;
}

/** Anything the graph can pull messages out of. */
export interface Source<O> extends AsyncIterable<O> {
	readonly id: string;
	stop(): Promise<void>;
}

/**
 * Inbound queue: backpressure (capacity 1) plus close semantics.
 *
 * After `stop` the buffered messages are still consumed and then the iteration
 * ends. A later `send` rejects, which is a signal a caller can act on — unlike
 * the previous sentinel-based shutdown, where that `send` would never return.
 */
export class Inbox<I> {
	private readonly channel: Chan<I> = new Chan<I>(1);
	private stopped: boolean = false;
	private consuming: boolean = false;

	send(input: I): Promise<void> {
		return this.channel.send(input);
	}

	stop(): Promise<void> {
		if (!this.stopped) {
			this.stopped = true;
			this.channel.close();
		}
		return Promise.resolve();
	}

	/** The one consume loop. An `Inbox` can be consumed exactly once. */
	async consume(handle: (input: I) => Promise<void>): Promise<void> {
		if (this.consuming) {
			throw new Error("Inbox is already being consumed");
		}
		this.consuming = true;
		for await (const input of this.channel) {
			await handle(input);
		}
	}
}

/**
 * Outbound queue: a stream that may be written to from anywhere and observed
 * by a single consumer.
 *
 * `fail` closes the stream *and* makes the consumer's `for await` throw, so a
 * crashing producer surfaces downstream instead of leaving it waiting forever.
 */
export class Outbox<O> implements AsyncIterable<O> {
	private readonly channel: Chan<O> = new Chan<O>(1);
	private closed: boolean = false;
	private started: boolean = false;
	private failure: { error: unknown } | undefined;

	push(output: O): Promise<void> {
		return this.channel.send(output);
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.channel.close();
	}

	fail(error: unknown): void {
		this.failure = { error };
		this.close();
	}

	/**
	 * The stream. Starting *is* iterating, so there is no separate `start` to
	 * forget; a second consumer throws instead of silently splitting messages.
	 */
	[Symbol.asyncIterator](): AsyncIterator<O> {
		if (this.started) {
			throw new Error("Outbox is already being consumed");
		}
		this.started = true;
		return this.drain();
	}

	private async *drain(): AsyncGenerator<O, void, undefined> {
		for await (const output of this.channel) {
			yield output;
		}
		if (this.failure) {
			throw this.failure.error;
		}
	}
}
