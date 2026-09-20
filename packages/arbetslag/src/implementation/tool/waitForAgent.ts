import { z } from "zod";
import { Result, ok } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { WAIT_TOOL_NAME } from "@/application/agent/report";
import createDebug from "debug";

const log = createDebug("arbetslag:tool");

const WaitForAgentInputSchema = z
  .object({
    agent_id: z
      .string()
      .describe("The Agent whose Report to wait for — exactly one Agent per call."),
  })
  .strict();

/**
 * A Wait is an open tool call: the handler cannot block, so it yields. When the
 * Report for the named Agent does not exist yet, this returns no result — the
 * orchestrator writes the Report as this tool call's response later, when the
 * Agent ends its turn. A Report already held is delivered at once.
 */
export class WaitForAgent implements Tool<
  z.infer<typeof WaitForAgentInputSchema>,
  string | undefined,
  string
> {
  name: string = WAIT_TOOL_NAME;
  description: string =
    "Wait for the Report of exactly one Agent you created. If it has already ended its turn you get that Report now; otherwise this call stays open and its result is that Report when the Agent finishes. One call per Agent.";
  inputSchema = WaitForAgentInputSchema;

  async call(
    context: ToolExecutingContext,
    caller: Agent,
    input: z.infer<typeof WaitForAgentInputSchema>,
  ): Promise<Result<string | undefined, string>> {
    const report = await context.getReport(input.agent_id);
    if (report === undefined) {
      log(`wait open: caller=${caller.id} waits for ${input.agent_id}`);
      return ok(undefined); // no response: the Report answers this call later
    }
    return ok(report);
  }
}
