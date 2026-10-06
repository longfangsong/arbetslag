import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { nanoid } from "nanoid";
import { text } from "@/application/agent/history";
import { Event } from "@/application/event/event";


const WaitAgentInputSchema = z
    .object({
        id: z
            .string()
            .describe("The ID of the agent to wait for."),
    })
    .strict();

export interface WaitAgentResult {
    content: string;
}

/**
 * The Creator side of a Sub-agent: one call, an immediate ack, the work
 * happens later. The report is not part of this result — it reaches the
 * Creator only through a Wait (task 0005/0006).
 */
export class WaitAgent implements Tool<
    z.infer<typeof WaitAgentInputSchema>,
    WaitAgentResult,
    string
> {
    name: string = "wait_agent";
    description: string =
        "Wait for an agent to complete its task and return the result. The call blocks until the agent has finished processing.";

    inputSchema = WaitAgentInputSchema;

    async call(
        context: ToolExecutingContext,
        _caller: Agent,
        input: z.infer<typeof WaitAgentInputSchema>,
    ): Promise<Result<WaitAgentResult, string>> {
        const results = context.toolState["subagent_result"] as
            | Record<string, Promise<string>>
            | undefined;
        const pending = results?.[input.id];
        if (!pending) {
            return err(
                `no agent with id "${input.id}" was spawned by this agent`,
            );
        }
        // Idempotent: the entry is kept, so waiting twice for the same agent
        // returns the same final result.
        return ok({ content: await pending });
    }
}
