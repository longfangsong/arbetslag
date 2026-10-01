import z from "zod";
import { Tool, ToolCallDoneEvent, ToolCallRequestEvent } from "../../../model/tool";
import { State } from "../../../model/state";
import { Event } from "../../..";
import { createFromTemplate } from "../../../model/agent";
import { text } from "../../../model/history";

const CreateAgentInputSchema = z
	.object({
		template: z
			.string()
			.describe("Name of a pre-declared Template to create the Sub-agent from."),
		task: z
			.string()
			.describe(
				"The task handed to the Sub-agent — it arrives as the Sub-agent's first message.",
			),
	})
	.strict();

export interface CreateAgentResult {
	agentId: string;
}

export class CreateAgent implements Tool<
	z.infer<typeof CreateAgentInputSchema>
> {
	id: string = "create_agent";
	description: string =
		"Create another agent from a pre-declared template and hand it a task. The call returns at once with the new agent's id — it does not wait for anything. The agent answers its creator, not the user, and its report reaches you only when you call `wait_agent` with its id.";
	inputSchema = CreateAgentInputSchema;
	
	async call(state: State, event: Event): Promise<State> {
		if (event.type !== "toolCallRequest") {
			return state;
		}
		const typedEvent = event as ToolCallRequestEvent<
			z.infer<typeof CreateAgentInputSchema>
		>;
		const template = state.persistent.templates.find(it => it.id === typedEvent.input.template)!;
		const { agent, history } = createFromTemplate(template);
		history.entries.push({
			role: "user",
			content: text(typedEvent.input.task)
		});
		// todo: persistent should use .modify(Self => Self) instead
		state.persistent.agents.push(agent);
		state.persistent.histories.push(history);

		state.runtime.eventBus.push({
			type: "toolCallDone",
			id: typedEvent.id,
			callerId: typedEvent.callerId,
			output: {
				agentId: agent.id,
			},
		} as ToolCallDoneEvent<CreateAgentResult>);

		return state;
	}
}