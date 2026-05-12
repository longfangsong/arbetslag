import { AgentTemplate } from "./model";

export class Repository {
    private templates: Array<AgentTemplate> = [];
    
    async getByName(name: string): Promise<AgentTemplate | null> {
        const template = this.templates.find(template => template.name === name);
        return template || null;
    }
    
    async list(): Promise<Array<AgentTemplate>> {
        return this.templates;
    }
}