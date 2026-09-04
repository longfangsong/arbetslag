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

export const CreateEntityInputSchema = z.object({
	schema: z.string().describe("Schema name for the entity"),
	properties: z.record(z.string(), z.string()).describe("Entity properties"),
	source: z.enum(MemorySource).describe("Source of this memory"),
	status: z.enum(MemoryStatus).nullish().describe("Initial status"),
});

export class CreateEntity
	implements Tool<z.infer<typeof CreateEntityInputSchema>, unknown, string>
{
	name = "create_entity";
	description = "Create a new entity in the ontology graph database.";
	inputSchema = CreateEntityInputSchema;

	private readonly baseUrl: string;

	constructor(config: OntologyConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof CreateEntityInputSchema>,
	): Promise<Result<unknown, string>> {
		return ontologyRequest(this.baseUrl, "/api/entities", {
			method: "POST",
			body: JSON.stringify(input),
		});
	}
}
