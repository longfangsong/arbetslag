import { AIProvider } from "./model";

export interface Repository {
	register(provider: AIProvider): Promise<AIProvider>;
	getByName(name: string): Promise<AIProvider | null>;
	list(): Promise<Array<AIProvider>>;
}
