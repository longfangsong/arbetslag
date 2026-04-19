import { nanoid } from "nanoid";
import { Context } from "./context";
import { Tool } from "./tool";
import { Session } from "./session";
import { AIProvider } from "./aiProvider";

export interface ToolConfig {
    name: string;
    metaParameters?: Record<string, any>;
}

export interface Template {
    name: string;
    description: string;
    provider: string;
    model: string;
    systemPrompt: string;
    tools: ToolConfig[];
}

export class Agent {
    readonly id: string;
    readonly template: Template;
    workingOn: Promise<string> | null = null;
    public tools: Array<Tool<any, any>>;
    private provider: AIProvider;

    constructor(context: Context, template: Template) {
        this.id = nanoid(10);
        this.template = template;
        this.provider = context.getAIProvider(template.provider)!;
        this.tools = [];

        for (const toolConfig of template.tools) {
            const ToolConstructor = context.getToolConstructor(toolConfig.name);
            if (!ToolConstructor) {
                console.warn(`Tool constructor not found for tool: ${toolConfig.name}`);
                continue;
            }
            const metaParams = toolConfig.metaParameters || {};
            const toolInstance = new ToolConstructor(metaParams);
            this.tools.push(toolInstance);
        }
    }

    async handleRequest(context: Context, session: Session, message: string): Promise<string> {
        this.workingOn = this.provider.sendMessage(context, session, this, message);
        session.agents.push(this);
        return this.workingOn!;
    }
}

