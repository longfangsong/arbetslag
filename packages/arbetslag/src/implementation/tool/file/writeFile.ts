import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const WriteFileInputSchema = z.object({
	path: z.string().describe("Path to the file to write."),
	content: z.string().describe("Content to write to the file."),
});

export class WriteFile
	implements Tool<z.infer<typeof WriteFileInputSchema>, void, string>
{
	name: string = "write_file";
	description: string = "Write content to a file, creating it or overwriting it.";
	inputSchema = WriteFileInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof WriteFileInputSchema>,
	): Promise<Result<void, string>> {
		try {
			await context.fileSystem.writeFile(input.path, input.content);
			return ok(undefined);
		} catch (error) {
			return err(
				`Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
