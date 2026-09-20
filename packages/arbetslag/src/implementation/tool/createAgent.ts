import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import createDebug from "debug";

const log = createDebug("arbetslag:tool");

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
	status: "created";
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
	name: string = "create_agent";
	description: string =
		"Create a Sub-agent from a pre-declared Template and hand it a task. The call returns at once with the new agent's id — it does not wait for anything. The Sub-agent answers its Creator, not the user, and its report reaches you only when you wait for it.";
	inputSchema = CreateAgentInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof CreateAgentInputSchema>,
	): Promise<Result<CreateAgentResult, string>> {
		const created = await context.createAgent(input.template, input.task);
		if (created.isErr()) {
			log(`❌ create_agent failed: ${created.error}`);
			return err(created.error);
		}
		return ok({ agentId: created.value, status: "created" });
	}
}
