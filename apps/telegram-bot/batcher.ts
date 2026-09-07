/**
 * Debounced per-chat batching.
 *
 * Items are queued per chatId; once no new item arrives for `quietMs`,
 * each chat's accumulated items are delivered in one shot via `onFlush`.
 * A burst of N messages therefore produces one delivery of N items.
 */
export class UpdateBatcher<T> {
	private pending = new Map<string, T[]>();
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly quietMs: number,
		private readonly onFlush: (chatId: string, items: T[]) => void,
	) {}

	get pendingCount(): number {
		return [...this.pending.values()].reduce((n, items) => n + items.length, 0);
	}

	enqueue(chatId: string, item: T): void {
		const items = this.pending.get(chatId) ?? [];
		items.push(item);
		this.pending.set(chatId, items);
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), this.quietMs);
		this.timer.unref?.();
	}

	/** Deliver anything pending immediately (e.g. on shutdown). */
	flushNow(): void {
		if (this.timer) clearTimeout(this.timer);
		this.flush();
	}

	private flush(): void {
		this.timer = null;
		for (const [chatId, items] of this.pending) {
			this.pending.delete(chatId);
			this.onFlush(chatId, items);
		}
	}
}
