import { z } from "zod";
import { Result, ok } from "neverthrow";
import { ToolExecutionContext } from "@/application/orchestrator";
import { Tool } from "@/domain/tool/model";
import { Agent } from "@/domain/agent/model";

export const GetTimeInputSchema = z
	.object({})
	.strict()
	.describe("No input required to get the current time.");

export class GetTime
	implements Tool<z.infer<typeof GetTimeInputSchema>, string, string>
{
	name: string = "get_time";
	description: string = "Get the current date and time.";
	inputSchema = GetTimeInputSchema;

	call(
		_state: ToolExecutionContext,
		caller: Agent,
		input: Record<string, never>,
	): Promise<Result<string, string>> {
		return Promise.resolve(ok(new Date().toString()));
	}
}
