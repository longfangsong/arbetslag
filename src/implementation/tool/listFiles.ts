import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const ListFilesInputSchema = z.object({
	directory: z.string().describe("Directory path to list files in."),
});

export class ListFiles
	implements Tool<z.infer<typeof ListFilesInputSchema>, string[], string>
{
	name: string = "list_files";
	description: string = "List files in a directory.";
	inputSchema = ListFilesInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof ListFilesInputSchema>,
	): Promise<Result<string[], string>> {
		try {
			return ok(await context.fileSystem.listFiles(input.directory));
		} catch (error) {
			return err(
				`Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
