import { Agent, type OutputHandler } from "../model";

export interface Template {
    name: string;
    description: string;

    ai_provider: string;
    model: string;
    systemPrompt: string;
    allowedTools: string[];
}

export function createAgent(template: Template, prompt?: string, outputHandler?: OutputHandler): Agent {
    const agent = Agent.create(template, outputHandler);
    agent.history.push({ role: 'system', content: template.systemPrompt });
    if (prompt)
        agent.history.push({ role: 'user', content: prompt });
    return agent;
}
