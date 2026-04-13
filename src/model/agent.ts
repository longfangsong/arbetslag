import { AIProvider } from "./aiProvider";
import { Context } from "./context";
import { Tool } from "./tool";
import { nanoid } from 'nanoid/non-secure';

export interface AgentTemplate {
    name: string;
    description: string;
    provider: string;
    model: string;
    systemPrompt: string;
    tools: Tool<any, any>[];
}

export class Agent {
    readonly id: string;
    readonly template: AgentTemplate;
    private provider: AIProvider;

    constructor(private context: Context, template: AgentTemplate) {
        this.id = nanoid(10);
        this.template = template;
        this.provider = context.aiProviders.get(template.provider)!;
    }

    async handleRequest(message: string): Promise<string> {
        console.log(`Agent '${this.id}' handling request with message:`, message);
        return this.provider.sendMessage(this.context, this.template.model, this.template.systemPrompt, message, this.template.tools);
    }
}
