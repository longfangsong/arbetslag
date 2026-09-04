import { z } from "zod";
import { Result, ok } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import {
	OntologyConfig,
	MemorySource,
	MemoryStatus,
	ontologyRequest,
} from "./shared";

export const ListEntitiesInputSchema = z.object({
	schema: z.string().nullish().describe("Filter by schema name"),
	source: z.enum(MemorySource).nullish().describe("Filter by source"),
	status: z.enum(MemoryStatus).nullish().describe("Filter by status"),
	limit: z.number().int().min(0).nullish().describe("Max results to return"),
});

export class ListEntities
	implements Tool<z.infer<typeof ListEntitiesInputSchema>, unknown, string>
{
	name = "list_entities";
	description = "List entities from the ontology graph database with optional filters.";
	inputSchema = ListEntitiesInputSchema;

	private readonly baseUrl: string;

	constructor(config: OntologyConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof ListEntitiesInputSchema>,
	): Promise<Result<unknown, string>> {
		const params = new URLSearchParams();
		if (input.schema != null) params.set("schema", input.schema);
		if (input.source != null) params.set("source", input.source);
		if (input.status != null) params.set("status", input.status);
		if (input.limit != null) params.set("limit", String(input.limit));

		const query = params.toString();
		const path = query ? `/api/entities?${query}` : "/api/entities";
		return ontologyRequest(this.baseUrl, path);
	}
}
