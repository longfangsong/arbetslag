import { Agent } from "../model";

export interface AgentTemplate {
    name: string;
    description: string;

    systemPrompt: string;
    allowedTools: string[];
}

export function createAgent(template: AgentTemplate, prompt: string): Agent {
    // todo!
}