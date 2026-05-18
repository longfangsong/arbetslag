import { Template } from "./model";

export class Repository {
    private templates: Array<Template> = [];
    
    async add(template: Template): Promise<void> {
        this.templates.push(template);
    }
    
    async getByName(name: string): Promise<Template | null> {
        const template = this.templates.find(template => template.name === name);
        return template || null;
    }
    
    async list(): Promise<Array<Template>> {
        return this.templates;
    }

    async default(): Promise<Template> {
        return this.templates[0];
    }
}