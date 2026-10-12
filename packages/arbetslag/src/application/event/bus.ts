import { Event } from "./event";
export class EventBus {
    public queue: Array<Event> = [];

    push(event: Event) {
        this.queue.push(event);
    }

    peek(): Event | undefined {
        return this.queue[0];
    }

    pop(): Event | undefined {
        return this.queue.shift();
    }

    empty() {
        return this.queue.length === 0;
    }
}