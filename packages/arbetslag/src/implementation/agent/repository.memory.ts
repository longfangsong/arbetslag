import { Repository } from "@/application/agent/repository";
import { Agent } from "@/application/agent/model";

export class InMemoryAgentRepository implements Repository {
	private agents: Map<string, Agent> = new Map();
	private chatMap: Map<string, string> = new Map();

	static async create(): Promise<InMemoryAgentRepository> {
		return new InMemoryAgentRepository();
	}

	async add(agent: Agent): Promise<Agent> {
		this.agents.set(agent.id, agent);
		return agent;
	}

	async save(_agent: Agent): Promise<void> {
		// ponytail: no-op, agent is already in memory
	}

	async getById(id: string): Promise<Agent | null> {
		return this.agents.get(id) ?? null;
	}

	async list(): Promise<Array<Agent>> {
		return Array.from(this.agents.values());
	}

	async setEntryAgent(chatId: string, agent: Agent): Promise<void> {
		this.chatMap.set(chatId, agent.id);
	}

	async getByChatId(chatId: string): Promise<Agent | null> {
		const agentId = this.chatMap.get(chatId);
		if (!agentId) return null;
		return this.agents.get(agentId) ?? null;
	}

	async getChatIdByAgentId(agentId: string): Promise<string | undefined> {
		for (const [chatId, id] of this.chatMap) {
			if (id === agentId) return chatId;
		}
		return undefined;
	}
}
