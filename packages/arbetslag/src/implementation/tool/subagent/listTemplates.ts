import { z } from "zod";
import { Result, ok } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

/** No input — the answer is the whole (static) set of Templates. */
export const ListTemplatesInputSchema = z.object({}).strict();

export class ListTemplates
	implements Tool<
		z.infer<typeof ListTemplatesInputSchema>,
		Array<{ name: string; description: string }>,
		string
	>
{
	name: string = "list_templates";
	description: string =
		"List every declared Template as name + description. Templates are static — use this to see which Sub-agent Templates exist before calling spawn_agent.";
	inputSchema = ListTemplatesInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		_input: z.infer<typeof ListTemplatesInputSchema>,
	): Promise<Result<Array<{ name: string; description: string }>, string>> {
		const templates = await context.templateRepository.list();
		return ok(
			templates.map((template) => ({
				name: template.name,
				description: template.description,
			})),
		);
	}
}
