import { Event } from "@/domain/event/model";

export interface InputAdopter {
	readonly tag: string;
	convert(update: unknown): Event | null;
}

export class InputAdopterRegistry {
	private adopters = new Map<string, InputAdopter>();

	register(adapter: string, adopter: InputAdopter): void {
		this.adopters.set(adapter, adopter);
	}

	get(adapter: string): InputAdopter | null {
		return this.adopters.get(adapter) ?? null;
	}
}
