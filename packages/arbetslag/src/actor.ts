import { Inbox, Outbox, type Sink, type Source } from "./messageBox";

/**
 * A node in the graph: something the graph can send to, which emits the results
 * of that work as a stream.
 *
 * Only nodes that are both a sink and a source are actors. A pure entry point
 * (`InputAdapter`) is a `Source` over an `Outbox`; a pure exit (`OutputAdapter`)
 * is a `Sink`.
 */
export abstract class Actor<I, O> implements Sink<I>, Source<O> {
	private readonly inbox: Inbox<I> = new Inbox<I>();
	private readonly outbox: Outbox<O> = new Outbox<O>();

	async send(input: I): Promise<void> {
		await this.inbox.send(input);
	}

	async stop(): Promise<void> {
		await this.inbox.stop();
	}

	[Symbol.asyncIterator](): AsyncIterator<O> {
		// Take the outbox's iterator first: a second consumer must fail loudly
		// without spawning a competing consume loop over the same inbox.
		const iterator = this.outbox[Symbol.asyncIterator]();
		void this.inbox
			.consume(async (input) => {
				for (const output of await this.process(input)) {
					await this.outbox.push(output);
				}
			})
			.then(
				() => this.outbox.close(),
				(error: unknown) => this.outbox.fail(error),
			);
		return iterator;
	}

	/** The business part: turn one input into zero or more outputs. */
	protected abstract process(input: I): Promise<ReadonlyArray<O>>;
}
