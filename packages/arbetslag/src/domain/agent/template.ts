import { JsonValue } from "type-fest";
import { SerializableClass } from "../serializable";
import { nanoid } from "../../utils";

export class Template {
    static id: "template";
    id: string;
    classId: string = Template.id;

    /// name of the template, used for identification and selection
	name: string;
	/// description of the template, used for display and selection
	description: string;
	/// which ai provider should agent created with this template use
	ai_provider: string;
	/// which model should agent created with this template use
	model: string;
	/// system prompt for the agent, can be a string or a function that returns a string
	systemPrompt: string;
	/// tools this agent is allowed to use
	allowedTools: string[];

    private constructor(
        id: string,
        name: string,
        description: string,
        ai_provider: string,
        model: string,
        systemPrompt: string,
        allowedTools: string[]
    ) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.ai_provider = ai_provider;
        this.model = model;
        this.systemPrompt = systemPrompt;
        this.allowedTools = allowedTools;
    }

    serialize(): JsonValue {
        return {
            id: this.id,
            classId: this.classId,
            name: this.name,
            description: this.description,
            ai_provider: this.ai_provider,
            model: this.model,
            systemPrompt: this.systemPrompt,
            allowedTools: this.allowedTools
        };
    }

    static deserialize(json: JsonValue): Template {
        const { id, name, description, ai_provider, model, systemPrompt, allowedTools } = json as {
            id: string;
            name: string;
            description: string;
            ai_provider: string;
            model: string;
            systemPrompt: string;
            allowedTools: string[];
        };
        return new Template(id, name, description, ai_provider, model, systemPrompt, allowedTools);
    }
}

Template satisfies SerializableClass;