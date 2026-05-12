export interface AgentTemplate {
    name: string;
    description: string;

    systemPrompt: string;
    allowedTools: string[];
}
