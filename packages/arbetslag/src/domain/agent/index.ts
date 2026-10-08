import { JsonValue } from "type-fest";
import { SerializableClass } from "../serializable";
import type { History } from "../history";
import { nanoid } from "../../utils";
import { Context, Template, text } from "../..";

export class Agent {
    static id: "agent";
    classId: string = Agent.id;

    private constructor(
        public id: string,
        public history: History
    ) { }

    serialize(): JsonValue {
        return {
            id: this.id,
            history: this.history,
            classId: this.classId
        };
    }

    static deserialize(json: JsonValue): Agent {
        const { id, history } = json as {
            id: string;
            history: History;
        };
        return new Agent(id, history);
    }

    async fromTemplate(context: Context, template: Template): Promise<Agent> {
        const result = new Agent(nanoid(), {
            entries: [
                {
                    role: "system",
                    content: text(template.systemPrompt),
                }
            ],
            lastKnownTokenCountIndex: 0,
            knownTokenCount: 0
        });
        context.storage.set(`${result.classId}/${result.id}`, result.serialize());
        return result;
    }
}

Agent satisfies SerializableClass;