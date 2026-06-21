import { AIProvider } from "./model";

export interface Repository {
	getByName(name: string): Promise<AIProvider | null>;
	list(): Promise<Array<AIProvider>>;
}
