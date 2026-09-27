import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import createDebug from "debug";
import { nanoid } from "nanoid";
import { text } from "@/application/agent/history";

const log = createDebug("arbetslag:tool");

const SpawnAgentInputSchema = z
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

export interface SpawnAgentResult {
	agentId: string;
}

/** `subagent` tool state: created agent id -> creator agent id. */
type ParentState = Record<string, string>;

/**
 * The Creator side of a Sub-agent: one call, an immediate ack, the work
 * happens later. The report is not part of this result — it reaches the
 * Creator only through a Wait (task 0005/0006).
 */
export class SpawnAgent implements Tool<
	z.infer<typeof SpawnAgentInputSchema>,
	SpawnAgentResult,
	string
> {
	name: string = "spawn_agent";
	description: string =
		"Create a Sub-agent from a pre-declared Template and hand it a task.";
	inputSchema = SpawnAgentInputSchema;

	async call(
		context: ToolExecutingContext,
		caller: Agent,
		input: z.infer<typeof SpawnAgentInputSchema>,
	): Promise<Result<SpawnAgentResult, string>> {
        const template = await context.templateRepository.getByName(input.template);
        const created_agent = Agent.create(template!, caller.outputRouter);
        await context.agentRepository.add(created_agent);
        const parents = (await context.toolState.get<ParentState>("subagent")) ?? {};
        parents[created_agent.id] = caller.id;
        await context.toolState.set("subagent", parents);
        context.eventBus.push({
			id: nanoid(10),
			event_type: "agent_message",
	        from_agent_id: caller.id,
	        to_agent_id: created_agent.id,
	        content: input.task
		});
		return ok({ agentId: created_agent.id });
	}
}
