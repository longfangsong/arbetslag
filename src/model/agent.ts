import { AIProvider } from "./aiProvider";
import { Context } from "./context";
import { Session } from "./session";
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
        this.provider = context.getAIProvider(template.provider)!;
    }

    async handleRequest(session: Session, message: string): Promise<string> {
        return this.provider.sendMessage(this.context, 
            session,
            this.id,
            this.template.model,
            this.template.systemPrompt,
            message,
            this.template.tools
        );
    }
}
