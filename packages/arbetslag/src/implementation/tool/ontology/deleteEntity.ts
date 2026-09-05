import { z } from "zod";
import { Result } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { OntologyConfig, ontologyRequest } from "./shared";

export const DeleteEntityInputSchema = z.object({
	id: z.string().describe("Entity UUID"),
});

export class DeleteEntity
	implements Tool<z.infer<typeof DeleteEntityInputSchema>, unknown, string>
{
	name = "delete_entity";
	description = "Delete an entity from the ontology graph database.";
	inputSchema = DeleteEntityInputSchema;

	private readonly baseUrl: string;

	constructor(config: OntologyConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof DeleteEntityInputSchema>,
	): Promise<Result<unknown, string>> {
		return ontologyRequest(this.baseUrl, `/api/entities/${input.id}`, {
			method: "DELETE",
		});
	}
}
