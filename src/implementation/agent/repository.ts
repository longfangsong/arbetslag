import { Repository } from "@/application/agent/repository";
import { Agent, SerializedAgent } from "@/application/agent/model";
import { FileSystem } from "@/application/filesystem/model";

export class FileSystemAgentRepository implements Repository {
	public chatMap: Map<string, string> = new Map();
	public readonly dir: string;

	constructor(
		private fs: FileSystem,
		dir: string = "agents/",
	) {
		this.dir = dir.endsWith("/") ? dir : dir + "/";
	}

	static async create(fs: FileSystem, dir = "agents/"): Promise<FileSystemAgentRepository> {
		const repo = new FileSystemAgentRepository(fs, dir);
		await repo.rebuild();
		return repo;
	}

	private async rebuild(): Promise<void> {
		try {
			const chatMapContent = await this.fs.readFile(`${this.dir}chat_map.json`);
			const entries = JSON.parse(chatMapContent) as Record<string, string>;
			this.chatMap = new Map(Object.entries(entries));
		} catch {
			// No chat map persisted yet
		}
	}

	async add(agent: Agent): Promise<Agent> {
		await this.fs.writeFile(
			`${this.dir}${agent.id}.json`,
			JSON.stringify(agent.serialize()),
		);
		return agent;
	}

	async getById(id: string): Promise<Agent | null> {
		try {
			const content = await this.fs.readFile(`${this.dir}${id}.json`);
			return Agent.deserialize(JSON.parse(content) as SerializedAgent);
		} catch {
			return null;
		}
	}

	async list(): Promise<Array<Agent>> {
		const paths = await this.fs.listFiles(this.dir);
		const fileNames = paths.filter((p) => {
			const name = p.split("/").pop() ?? p;
			return p.endsWith(".json") && !name.startsWith(".") && name !== "chat_map.json";
		});
		const contents = await Promise.all(
			fileNames.map((p) => this.fs.readFile(p)),
		);
		return contents.map((c) =>
			Agent.deserialize(JSON.parse(c) as SerializedAgent),
		);
	}

	async setEntryAgent(chatId: string, agent: Agent): Promise<void> {
		this.chatMap.set(chatId, agent.id);
		await this.fs.writeFile(
			`${this.dir}chat_map.json`,
			JSON.stringify(Object.fromEntries(this.chatMap)),
		);
	}

	async getByChatId(chatId: string): Promise<Agent | null> {
		const agentId = this.chatMap.get(chatId);
		if (!agentId) return null;
		return this.getById(agentId);
	}

	async getChatIdByAgentId(agentId: string): Promise<string | undefined> {
		for (const [chatId, id] of this.chatMap) {
			if (id === agentId) return chatId;
		}
		return undefined;
	}
}
