import { z } from "zod";
import { Result, ok } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const GetTimeInputSchema = z.object({}).strict();

export class GetTime implements Tool<z.infer<typeof GetTimeInputSchema>, string, string> {
	name: string = "get_time";
	description: string = "Get the current date and time.";
	inputSchema = GetTimeInputSchema;

	call(
		_context: ToolExecutingContext,
		_caller: Agent,
		_input: z.infer<typeof GetTimeInputSchema>,
	): Promise<Result<string, string>> {
		return Promise.resolve(ok(new Date().toString()));
	}
}
