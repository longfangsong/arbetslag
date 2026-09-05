import { z } from "zod";
import { Result } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { OntologyConfig, ontologyRequest } from "./shared";

export const PatchEntityInputSchema = z.object({
	id: z.string().describe("Entity UUID"),
	status: z.string().describe("New status"),
	reviewedBy: z.string().nullish().describe("Who reviewed this entity"),
});

export class PatchEntity
	implements Tool<z.infer<typeof PatchEntityInputSchema>, unknown, string>
{
	name = "patch_entity";
	description = "Update the review status of an entity in the ontology graph database.";
	inputSchema = PatchEntityInputSchema;

	private readonly baseUrl: string;

	constructor(config: OntologyConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof PatchEntityInputSchema>,
	): Promise<Result<unknown, string>> {
		return ontologyRequest(this.baseUrl, `/api/entities/${input.id}`, {
			method: "PATCH",
			body: JSON.stringify({
				status: input.status,
				reviewed_by: input.reviewedBy,
			}),
		});
	}
}
