import { State } from "@/application/orchestrator";
import { Agent } from "@/domain/agent/model";
import { Tool } from "@/domain/tool/model";
import { ok, Result } from "neverthrow";
import z from "zod";

export const ListTemplatesInputSchema = z.object({}) satisfies z.ZodTypeAny;

type Output = Array<{name: string, description: string}>;   

export class ListTemplates implements Tool<z.infer<typeof ListTemplatesInputSchema>, Output, never> {
    name: string = "list_templates";
    description = "List all available agent templates in the system.";
    inputSchema = ListTemplatesInputSchema;

    call(state: State, caller: Agent, input: Record<string, never>): Promise<Result<Output, never>> {
        return state.agent_template_repository.list().then(templates => {
            return ok(templates.map(t => ({ name: t.name, description: t.description })));
        });
    }
}