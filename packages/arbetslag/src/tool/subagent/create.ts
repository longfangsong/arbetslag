import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool } from "../../model/tool";
import { Agent, create, createFromTemplate } from "../../model/agent";
import { State } from "../../model/state";
import { text } from "../../model/history";

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

/**
 * The Creator side of a Sub-agent: one call, an immediate ack, the work
 * happens later. The report is not part of this result — it reaches the
 * Creator only through a Wait (task 0005/0006).
 */
export class CreateAgent implements Tool<
	z.infer<typeof CreateAgentInputSchema>,
	CreateAgentResult,
	string
> {
	id: string = "create_agent";
	description: string =
		"Create a Sub-agent from a pre-declared Template and hand it a task. The call returns at once with the new agent's id — it does not wait for anything. The Sub-agent answers its Creator, not the user, and its report reaches you only when you wait for it.";
	inputSchema = CreateAgentInputSchema;
	
	async call(context: State, caller: Agent, input: { template: string; task: string; }): Promise<Result<CreateAgentResult, string>> {
		const template = context.persistent.templates.find(it => it.id === input.template)!;
		const { agent, history } = createFromTemplate(template);
		history.entries.push({
			role: "user",
			content: text(input.task)
		});
		// todo: persistent should use .modify(Self => Self) instead
		context.persistent.agents.push(agent);
		context.persistent.histories.push(history);

		return ok({ agentId: agent.id });
	}
}