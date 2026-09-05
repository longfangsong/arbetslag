import { Template } from "./model";

export interface Repository {
	add(template: Template): Promise<void>;
	getByName(name: string): Promise<Template | null>;
	list(): Promise<Array<Template>>;
	default(): Promise<Template>;
}
