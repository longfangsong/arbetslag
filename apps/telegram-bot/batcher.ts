/**
 * Debounced per-chat batching.
 *
 * Items are queued per chatId with an independent timer per chat; once no
 * new item arrives for `quietMs` in a chat, that chat's accumulated items
 * are delivered in one shot via `onFlush`. A burst of N messages therefore
 * produces one delivery of N items, without delaying other chats.
 */
export class UpdateBatcher<T> {
	private pending = new Map<string, T[]>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

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
		const existing = this.timers.get(chatId);
		if (existing) clearTimeout(existing);
		const timer = setTimeout(() => this.flush(chatId), this.quietMs);
		timer.unref?.();
		this.timers.set(chatId, timer);
	}

	/** Deliver anything pending immediately (e.g. on shutdown). */
	flushNow(): void {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		for (const [chatId, items] of this.pending) {
			this.pending.delete(chatId);
			this.onFlush(chatId, items);
		}
	}

	private flush(chatId: string): void {
		const timer = this.timers.get(chatId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(chatId);
		}
		const items = this.pending.get(chatId);
		if (!items) return;
		this.pending.delete(chatId);
		this.onFlush(chatId, items);
	}
}
