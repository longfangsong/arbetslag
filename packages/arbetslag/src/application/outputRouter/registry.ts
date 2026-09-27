import type { OutputRouter, SerializedOutputRouter } from "./model";

export type OutputRouterFactory = (config: Record<string, unknown>) => OutputRouter;

/** kind -> factory: rebuilds a persisted router when its Agent is deserialized. */
export class OutputRouterRegistry {
	private readonly factories = new Map<string, OutputRouterFactory>();

	constructor(entries: Array<[string, OutputRouterFactory]>) {
		for (const [kind, factory] of entries) {
			this.factories.set(kind, factory);
		}
	}

	resolve(data: SerializedOutputRouter): OutputRouter {
		return this.factories.get(data.kind)?.(data.config)!;
	}
}
