import { z } from "zod";
import { Result } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { OntologyConfig, ontologyRequest } from "./shared";

export const GetEntityRelationshipsInputSchema = z.object({
	id: z.string().describe("Entity UUID"),
});

export class GetEntityRelationships
	implements
		Tool<z.infer<typeof GetEntityRelationshipsInputSchema>, unknown, string>
{
	name = "get_entity_relationships";
	description =
		"Get all relationships for an entity from the ontology graph database.";
	inputSchema = GetEntityRelationshipsInputSchema;

	private readonly baseUrl: string;

	constructor(config: OntologyConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof GetEntityRelationshipsInputSchema>,
	): Promise<Result<unknown, string>> {
		return ontologyRequest(
			this.baseUrl,
			`/api/entities/${input.id}/relationships`,
		);
	}
}
