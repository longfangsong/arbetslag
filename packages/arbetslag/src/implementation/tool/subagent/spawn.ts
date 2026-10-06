import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { nanoid } from "nanoid";
import { text } from "@/application/agent/history";
import { Event } from "@/application/event/event";


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
    name: string = "spawn_agent";
    description: string =
        "Create a new agent from a pre-declared Template and hand it a task. The call returns at once with the new agent's id — it does not wait for anything. The response reaches you only when you wait for it.";
    inputSchema = CreateAgentInputSchema;

    async call(
        context: ToolExecutingContext,
        _caller: Agent,
        input: z.infer<typeof CreateAgentInputSchema>,
    ): Promise<Result<CreateAgentResult, string>> {
        const template = await context.templateRepository.getByName(input.template);
        if (!template) {
            return err(`template not found: ${input.template}`);
        }
        const created = Agent.create(template);
        created.history.push({
            role: "user",
            content: text(input.task)
        });
        await context.agentRepository.add(created);
        if (context.toolState["subagent_result"] === undefined) {
            context.toolState["subagent_result"] = {};
        }
        // Register the result promise BEFORE pushing the request: the
        // sub-agent's response can only fire the listener once it is
        // subscribed, no matter how the loop schedules events.
        //
        // The sub-agent's task is done only on its final turn — a response
        // without tool calls. Earlier turns are intermediate work (the agent
        // is still calling tools) and must not be reported as the result.
        (context.toolState["subagent_result"] as Record<string, Promise<string>>)[created.id] = new Promise(resolve => {
            const unsubscribe = context.bus.listen(async (e: Event) => {
                if (
                    e.event_type === "llm_completion_response" &&
                    e.to_agent_id === created.id &&
                    !e.tool_calls?.length
                ) {
                    unsubscribe();
                    resolve(e.content);
                }
            });
        });
        context.bus.push({
            id: nanoid(10),
            event_type: "llm_completion_request",
            from_agent_id: created.id,
            history: created.history
        });
        return ok({ agentId: created.id });
    }
}
