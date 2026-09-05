import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const DeleteFileInputSchema = z.object({
	path: z.string().describe("Path to the file to delete."),
});

export class DeleteFile
	implements Tool<z.infer<typeof DeleteFileInputSchema>, void, string>
{
	name: string = "delete_file";
	description: string = "Delete a file.";
	inputSchema = DeleteFileInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof DeleteFileInputSchema>,
	): Promise<Result<void, string>> {
		try {
			await context.fileSystem.deleteFile(input.path);
			return ok(undefined);
		} catch (error) {
			return err(
				`Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
