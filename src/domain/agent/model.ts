import { State } from "@/application/orchestrator";
import { nanoid } from "nanoid";
import { Template } from "./template/model";
import { complete, HistoryEntry } from "../aiProvider/model";
import { ApiCallbackEvent, Event, MessageEvent, ToolResponseEvent } from "@/domain/event/model";
import { Repository as TemplateRepository } from "./template/repository";
import { template } from "node_modules/es-toolkit/dist/compat/string/template";

export interface SerializedAgent {
    id: string;
    template_name: string;
    history: Array<HistoryEntry>;
}

export class Agent {
    public readonly id: string;
    public readonly template: Template;
    public history: Array<HistoryEntry> = [];

    private constructor(id: string, template: Template, history: Array<HistoryEntry>) {
        this.id = id;
        this.template = template;
        this.history = history;
    }

    static create(template: Template): Agent {
        return new Agent(nanoid(10), template, []);
    }

    static async deserialize(data: SerializedAgent, templateRepo: TemplateRepository): Promise<Agent> {
        const template = await templateRepo.getByName(data.template_name);
        if (!template) {
            throw new Error(`Template not found: ${data.template_name}`);
        }
        return new Agent(data.id, template, data.history);
    }

    async handleEvent(state: State, event: Event): Promise<State> {
        switch (event.event_type) {
            case 'tool_call':
                throw new Error("Tool calls should be handled by the orchestrator, not the agent");
            case 'message': {
                const msg = event as MessageEvent;
                this.history.push({
                    role: 'user',
                    content: msg.payload.content,
                });
            }
            case 'api_callback': {
                const apiEvent = event as ApiCallbackEvent;
                this.history.push({
                    role: 'user',
                    content: `<api_callback>
                        <id>${apiEvent.id}</id>
                        <api_name>${apiEvent.payload.api_name}</api_name>
                        <payload>
                            ${apiEvent.payload.content}
                        </payload>
                    </api_callback>`,
                });
            }
            case 'tool_response': {
                const resp = event as ToolResponseEvent;
                this.history.push({
                    role: 'tool',
                    tool_call_id: resp.payload.tool_call_id,
                    name: resp.payload.name,
                    content: resp.payload.content,
                });
            }
        }
        return complete(state, this);
    }

    serialize(): SerializedAgent {
        return {
            id: this.id,
            template_name: this.template.name,
            history: this.history,
        };
    }
}