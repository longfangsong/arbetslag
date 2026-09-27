import { Agent } from "@/application/agent/model";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { ok, Result } from "neverthrow";
import z from "zod";

const WaitForAgentInputSchema = z
    .object({
        id: z
            .string()
            .describe(
                "The id of the agent we are waiting for",
            ),
    })
    .strict();

export interface WaitForAgentResult {
    result: string;
}

export class WaitForAgent implements Tool<
    z.infer<typeof WaitForAgentInputSchema>,
    WaitForAgentResult,
    string
> {
    name: string = "wait_for_agent";
    description = "Wait for an agent to complete and get its result back";
    inputSchema = WaitForAgentInputSchema;
    async call(context: ToolExecutingContext, caller: Agent, input: z.infer<typeof WaitForAgentInputSchema>): Promise<Result<WaitForAgentResult, string>> {
        const theAgent = (await (context.agentRepository.getById(input.id)!))!;
        const lastHistory = theAgent.history[theAgent.history.length - 1];
        if (lastHistory.role === "assistant" && (lastHistory.tool_calls === undefined || lastHistory.tool_calls.length === 0)) {
            return ok({ result: theAgent.history[theAgent.history.length - 1].content as string });
        }
        throw new Error("Method not implemented.");
    }
}