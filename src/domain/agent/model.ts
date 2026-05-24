import { Config, MutableState as State } from "@/application/orchestrator";
import { nanoid } from "nanoid";
import { Template } from "./template/model";
import { complete, HistoryEntry } from "../aiProvider/model";
import {
	ApiCallbackEvent,
	AgentMessageEvent,
	Event,
	MessageEvent,
	ToolResponseEvent,
} from "@/domain/event/model";
import { Repository as TemplateRepository } from "./template/repository";
import {
	OutputHandler,
	ToParentOutputHandler,
	OutputHandlerRegistry,
	deserializeOutputHandler,
	serializeOutputHandler,
} from "../outputHandler/model";

export type { OutputHandler };

export type SerializedOutputHandler =
	| { type: "user"; adapter: string; chat_id: string }
	| { type: "to_parent"; parent_agent_id: string };

export interface SerializedAgent {
	id: string;
	template_name: string;
	history: Array<HistoryEntry>;
	output_handler: SerializedOutputHandler;
}

export class Agent {
	public readonly id: string;
	public readonly template: Template;
	public readonly outputHandler: OutputHandler;
	public history: Array<HistoryEntry> = [];

	private constructor(
		id: string,
		template: Template,
		outputHandler: OutputHandler,
		history: Array<HistoryEntry>,
	) {
		this.id = id;
		this.template = template;
		this.outputHandler = outputHandler;
		this.history = history;
	}

	static create(template: Template, outputHandler?: OutputHandler): Agent {
		return new Agent(
			nanoid(10),
			template,
			outputHandler ?? new ToParentOutputHandler("root"),
			[],
		);
	}

	static async deserialize(
		data: SerializedAgent,
		templateRepo: TemplateRepository,
		registry?: OutputHandlerRegistry,
	): Promise<Agent> {
		const template = await templateRepo.getByName(data.template_name);
		if (!template) {
			throw new Error(`Template not found: ${data.template_name}`);
		}
		const outputHandler = deserializeOutputHandler(
			data.output_handler,
			registry,
		);
		return new Agent(data.id, template, outputHandler, data.history);
	}

	async handleEvent(config: Config, state: State, event: Event): Promise<State> {
		switch (event.event_type) {
			case "tool_call":
				throw new Error(
					"Tool calls should be handled by the orchestrator, not the agent",
				);
			case "message": {
				const msg = event as MessageEvent;
				this.history.push({
					role: "user",
					content: msg.payload.content,
				});
				break;	
			}
			case "agent_message": {
				const agentMsg = event as AgentMessageEvent;
				this.history.push({
					role: "user",
					content: agentMsg.payload.content,
				});
				break;
			}
			case "api_callback": {
				const apiEvent = event as ApiCallbackEvent;
				this.history.push({
					role: "user",
					content: `<api_callback>
                        <id>${apiEvent.id}</id>
                        <api_name>${apiEvent.payload.api_name}</api_name>
                        <payload>
                            ${apiEvent.payload.content}
                        </payload>
                    </api_callback>`,
				});
				break;
			}
			case "tool_response": {
				const resp = event as ToolResponseEvent;
				this.history.push({
					role: "tool",
					tool_call_id: resp.payload.tool_call_id,
					name: resp.payload.name,
					content: resp.payload.content,
				});
				break;
			}
		}
		return complete(config, state, this);
	}

	serialize(): SerializedAgent {
		return {
			id: this.id,
			template_name: this.template.name,
			history: this.history,
			output_handler: serializeOutputHandler(this.outputHandler),
		};
	}
}
