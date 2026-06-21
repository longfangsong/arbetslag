import { Tool } from "./model";

export interface Repository {
	tools: Array<Tool<unknown, unknown, unknown>>;

	getByName(name: string): Promise<Tool<unknown, unknown, unknown> | null>;

	getByNames(names: string[]): Array<Tool<unknown, unknown, unknown>>;
}
