import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const ListTemplatesInputSchema = z.object({}).strict();

export interface ListTemplateItem {
	name: string;
	description: string;
	model: string;
}

export class ListTemplates
	implements Tool<z.infer<typeof ListTemplatesInputSchema>, ListTemplateItem[], string>
{
	name: string = "list_templates";
	description: string =
		"List all pre-declared Templates with their name, description and model.";
	inputSchema = ListTemplatesInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		_input: z.infer<typeof ListTemplatesInputSchema>,
	): Promise<Result<ListTemplateItem[], string>> {
		try {
			const templates = await context.templateRepository.list();
			return ok(
				templates.map((t) => ({
					name: t.name,
					description: t.description,
					model: t.model,
				})),
			);
		} catch (error) {
			return err(
				`Failed to list templates: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
