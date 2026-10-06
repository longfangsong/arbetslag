import { Event } from "./event";
export class EventBus {
    public queue: Array<Event> = [];
    private callbacks: Array<(e: Event) => Promise<void>> = [];

    push(event: Event) {
        // Copy: a callback may unsubscribe itself during the loop.
        for (const callback of [...this.callbacks]) {
            callback(event);
        }
        this.queue.push(event);
    }

    pop(): Event | undefined {
        return this.queue.shift();
    }

    empty() {
        return this.queue.length === 0;
    }

    /** Subscribe to every pushed event. Returns an unsubscribe function. */
    listen(callback: (e: Event) => Promise<void>): () => void {
        this.callbacks.push(callback);
        return () => {
            const i = this.callbacks.indexOf(callback);
            if (i !== -1) this.callbacks.splice(i, 1);
        };
    }
}