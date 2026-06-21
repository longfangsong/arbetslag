import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const ReadFileInputSchema = z.object({
	path: z.string().describe("Path to the file to read."),
});

export class ReadFile
	implements Tool<z.infer<typeof ReadFileInputSchema>, string, string>
{
	name: string = "read_file";
	description: string = "Read the contents of a file.";
	inputSchema = ReadFileInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof ReadFileInputSchema>,
	): Promise<Result<string, string>> {
		try {
			return ok(await context.fileSystem.readFile(input.path));
		} catch (error) {
			return err(
				`Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
