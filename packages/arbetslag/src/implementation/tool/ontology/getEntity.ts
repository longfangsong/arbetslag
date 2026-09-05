import { z } from "zod";
import { Result } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { OntologyConfig, ontologyRequest } from "./shared";

export const GetEntityInputSchema = z.object({
	id: z.string().describe("Entity UUID"),
});

export class GetEntity
	implements Tool<z.infer<typeof GetEntityInputSchema>, unknown, string>
{
	name = "get_entity";
	description = "Get a single entity by ID from the ontology graph database.";
	inputSchema = GetEntityInputSchema;

	private readonly baseUrl: string;

	constructor(config: OntologyConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof GetEntityInputSchema>,
	): Promise<Result<unknown, string>> {
		return ontologyRequest(this.baseUrl, `/api/entities/${input.id}`);
	}
}
