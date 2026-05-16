import { Agent, SerializedAgent } from "./model";
import { Repository as TemplateRepository } from "./template/repository";

export class Repository {
    private agents: Array<Agent> = [];

    static async deserialize(data: Array<SerializedAgent>, templateRepo: TemplateRepository): Promise<Repository> {
        const repo = new Repository();
        repo.agents = await Promise.all(data.map(agentData => Agent.deserialize(agentData, templateRepo)));
        return repo;
    }

    serialize(): Array<SerializedAgent> {
        return this.agents.map(agent => agent.serialize());
    }

    // FIXME: Should have a better way to mark default agent
    default(): Agent {
        return this.agents[0];
    }

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