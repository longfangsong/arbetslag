import { MutableState } from "@/application/orchestrator";
import { Agent } from "../agent/model";
import { nanoid } from "nanoid";

export type SerializedOutputHandler =
	| { type: "user"; adapter: string; chat_id: string }
	| { type: "to_parent"; parent_agent_id: string };

export interface OutputHandler {
	readonly tag: string;
	handle(state: MutableState, agent: Agent, content: string): Promise<MutableState>;
}

export abstract class UserOutputHandler implements OutputHandler {
	readonly tag = "user";

	constructor(
		readonly adapter: string,
		readonly chat_id: string,
	) {}

	abstract handle(
		state: MutableState,
		_agent: Agent,
		_content: string,
	): Promise<MutableState>;
}

export class ToParentOutputHandler implements OutputHandler {
	readonly tag = "to_parent";

	constructor(readonly parent_agent_id: string) {}

	async handle(state: MutableState, _agent: Agent, content: string): Promise<MutableState> {
		// Push a message event targeting the parent agent
		state.eventQueue.push({
			id: nanoid(10),
			to_agent_id: this.parent_agent_id,
			event_type: "agent_message" as const,
			payload: { content },
		});
		return state;
	}
}

export class OutputHandlerRegistry {
	private handlers = new Map<string, UserOutputHandler>();

	register(adapter: string, chat_id: string, handler: UserOutputHandler): void {
		this.handlers.set(`${adapter}:${chat_id}`, handler);
	}

	get(adapter: string, chat_id: string): UserOutputHandler | null {
		return this.handlers.get(`${adapter}:${chat_id}`) ?? null;
	}
}

export function serializeOutputHandler(
	handler: OutputHandler,
): SerializedOutputHandler {
	switch (handler.tag) {
		case "user":
			return {
				type: "user",
				adapter: (handler as UserOutputHandler).adapter,
				chat_id: (handler as UserOutputHandler).chat_id,
			};
		case "to_parent":
			return {
				type: "to_parent",
				parent_agent_id: (handler as ToParentOutputHandler).parent_agent_id,
			};
		default:
			throw new Error(
				`Unknown output handler type: ${(handler as OutputHandler).tag}`,
			);
	}
}

export function deserializeOutputHandler(
	serialized: SerializedOutputHandler,
	registry?: OutputHandlerRegistry,
): OutputHandler {
	switch (serialized.type) {
		case "user": {
			const handler = registry?.get(serialized.adapter, serialized.chat_id);
			if (!handler) {
				throw new Error(
					`Output handler not found for adapter=${serialized.adapter}, chat_id=${serialized.chat_id}`,
				);
			}
			return handler;
		}
		case "to_parent":
			return new ToParentOutputHandler(serialized.parent_agent_id);
	}
}
