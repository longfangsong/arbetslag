import { State } from "@/application/orchestrator";
import { nanoid } from "nanoid";
import { Template } from "./template/model";
import { complete, HistoryEntry } from "../aiProvider/model";
import { ApiCallbackEvent, Event, MessageEvent, ToolResponseEvent } from "@/domain/event/model";

export class Agent {
    public readonly id: string;
    public readonly template: Template;
    public history: Array<HistoryEntry> = [];

    constructor(template: Template) {
        this.id = nanoid(10);
        this.template = template;
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
}