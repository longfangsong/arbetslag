import { z } from "zod";
import { Result } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { OntologyConfig, ontologyRequest } from "./shared";

export const GetRelationshipInputSchema = z.object({
	id: z.string().describe("Relationship UUID"),
});

export class GetRelationship
	implements Tool<z.infer<typeof GetRelationshipInputSchema>, unknown, string>
{
	name = "get_relationship";
	description = "Get a relationship by ID from the ontology graph database.";
	inputSchema = GetRelationshipInputSchema;

	private readonly baseUrl: string;

	constructor(config: OntologyConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof GetRelationshipInputSchema>,
	): Promise<Result<unknown, string>> {
		return ontologyRequest(
			this.baseUrl,
			`/api/relationships/${input.id}`,
		);
	}
}
