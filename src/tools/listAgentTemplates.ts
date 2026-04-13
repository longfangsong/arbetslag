import { Agent, AgentTemplate } from "@/model/agent";
import { Context } from "@/model/context";
import { Tool } from "@/model/tool";
import { z } from "zod";

export const ListAgentTemplatesInputSchema = z.object({}) satisfies z.ZodTypeAny;

export interface ListAgentTemplatesConstraints {
    agentTemplates: AgentTemplate[];
}

export class ListAgentTemplates implements Tool<typeof ListAgentTemplatesInputSchema, Array<{name: string; description: string; id: number}>> {
    name: string = "listAgentTemplates";
    get description(): string {
        return "List all available agent templates in the system.";
    }
    inputSchema = ListAgentTemplatesInputSchema;

    constructor(private constraints: ListAgentTemplatesConstraints) { }

    async handler(context: Context, input: z.infer<typeof ListAgentTemplatesInputSchema>): Promise<Array<{name: string; description: string; id: number}>> {
        return this.constraints.agentTemplates.map((template, index) => ({
            id: index,
            name: template.name,
            description: template.description,
        }));
    }
}
