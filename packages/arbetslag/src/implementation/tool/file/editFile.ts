import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const EditFileInputSchema = z.object({
	path: z.string().describe("Path to the file to edit."),
	content: z.string().describe("New content to insert."),
	offset: z.number().describe("Character offset to start editing at."),
	length: z.number().describe("Number of characters to replace."),
});

export class EditFile
	implements Tool<z.infer<typeof EditFileInputSchema>, void, string>
{
	name: string = "edit_file";
	description: string = "Edit a file by replacing a range of characters with new content.";
	inputSchema = EditFileInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof EditFileInputSchema>,
	): Promise<Result<void, string>> {
		try {
			await context.fileSystem.editFile(
				input.path,
				input.content,
				input.offset,
				input.length,
			);
			return ok(undefined);
		} catch (error) {
			return err(
				`Failed to edit file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
