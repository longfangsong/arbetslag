import { Tool } from "./model";

export class Repository {
    private tools: Array<Tool<any, any, any>> = [];

    async getByName(name: string): Promise<Tool<any, any, any> | null> {
        const tool = this.tools.find(tool => tool.name === name);
        return tool || null;
    }
}
