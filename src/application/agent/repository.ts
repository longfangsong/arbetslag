import { Agent } from "./model";

export interface Repository {
	add(agent: Agent): Promise<Agent>;
	save(agent: Agent): Promise<void>;
	getById(id: string): Promise<Agent | null>;
	list(): Promise<Array<Agent>>;
	setEntryAgent(chatId: string, agent: Agent): Promise<void>;
	getByChatId(chatId: string): Promise<Agent | null>;
	getChatIdByAgentId(agentId: string): Promise<string | undefined>;
}
