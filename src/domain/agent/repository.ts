import { Agent } from "./model";

export class Repository {
    private agents: Array<Agent> = [];

    async add(agent: Agent): Promise<void> {
        this.agents.push(agent);
    }

    async getById(id: string): Promise<Agent | null> {
        const agent = this.agents.find(agent => agent.id === id);
        return agent || null;
    }

    async list(): Promise<Array<Agent>> {
        return this.agents;
    }
}