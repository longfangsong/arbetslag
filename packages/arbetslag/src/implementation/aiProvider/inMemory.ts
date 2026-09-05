import { Repository } from "@/application/aiProvider/repository";
import { AIProvider } from "@/application/aiProvider/model";

export class InMemoryAIProviderRepository implements Repository {
	private providers: Map<string, AIProvider> = new Map();

	constructor(providers: Array<AIProvider> = []) {
		for (const provider of providers) {
			this.providers.set(provider.name, provider);
		}
	}

	async getByName(name: string): Promise<AIProvider | null> {
		return this.providers.get(name) ?? null;
	}

	async list(): Promise<Array<AIProvider>> {
		return Array.from(this.providers.values());
	}
}
