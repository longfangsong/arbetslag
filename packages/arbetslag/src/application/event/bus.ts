import { Event } from "./event";
export class EventBus {
    public queue: Array<Event> = [];
    private callbacks: Array<(e: Event) => Promise<void>> = [];

    push(event: Event) {
        for (let callback of this.callbacks) {
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

    listen(callback: (e: Event) => Promise<void>) {
        this.callbacks.push(callback);
    }
}