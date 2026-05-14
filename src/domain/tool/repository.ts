import { Tool } from "./model";

export class Repository {
    public tools: Array<Tool<unknown, unknown, unknown>> = [];

    async getByName(name: string): Promise<Tool<unknown, unknown, unknown> | null> {
        const tool = this.tools.find(tool => tool.name === name);
        return tool || null;
    }
}
