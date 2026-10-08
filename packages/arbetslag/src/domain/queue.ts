import { JsonValue } from "type-fest";
import { Context } from "./context";
import { SerializableClass } from "./serializable";

export class Queue<T extends JsonValue> {
    static id: "queue";
    classId: string = Queue.id;

    private constructor(
        public id: string,
        public items: Array<T>
    ) { }

    serialize(): JsonValue {
        return {
            id: this.id,
            classId: this.classId,
            items: this.items
        };
    }

    static deserialize<T extends JsonValue>(json: JsonValue): Queue<T> {
        const { id, items } = json as {
            id: string;
            items: Array<T>;
        };
        return new Queue(id, items);
    }

    async push_back(ctx: Context, item: T): Promise<void> {
        this.items.push(item);
        ctx.storage.set(`${this.classId}/${this.id}`, this.serialize());
    }
    front(): Promise<T | undefined> {
        return Promise.resolve(this.items[0]);
    }
    async pop_front(ctx: Context): Promise<T | undefined> {
        const item = this.items.shift();
        ctx.storage.set(`${this.classId}/${this.id}`, this.serialize());
        return Promise.resolve(item);
    }
}

Queue satisfies SerializableClass;
