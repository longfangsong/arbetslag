import { z } from "zod";
import { Result } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import {
	OntologyConfig,
	MemorySource,
	MemoryStatus,
	ontologyRequest,
} from "./shared";

export const CreateRelationshipInputSchema = z.object({
	schema: z.string().describe("Relationship schema name"),
	fromId: z.string().describe("Source entity UUID"),
	toId: z.string().describe("Target entity UUID"),
	properties: z.record(z.string(), z.string()).describe("Relationship properties"),
	source: z.enum(MemorySource).describe("Source of this memory"),
	status: z.enum(MemoryStatus).nullish().describe("Initial status"),
});

export class CreateRelationship
	implements
		Tool<z.infer<typeof CreateRelationshipInputSchema>, unknown, string>
{
	name = "create_relationship";
	description = "Create a relationship between two entities in the ontology graph database.";
	inputSchema = CreateRelationshipInputSchema;

	private readonly baseUrl: string;

	constructor(config: OntologyConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof CreateRelationshipInputSchema>,
	): Promise<Result<unknown, string>> {
		return ontologyRequest(this.baseUrl, "/api/relationships", {
			method: "POST",
			body: JSON.stringify({
				schema: input.schema,
				from_id: input.fromId,
				to_id: input.toId,
				properties: input.properties,
				source: input.source,
				status: input.status,
			}),
		});
	}
}
