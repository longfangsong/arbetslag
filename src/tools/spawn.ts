import { Agent, AgentTemplate } from "@/model/agent";
import { Context } from "@/model/context";
import { Tool } from "@/model/tool";
import { z } from "zod";
import { clone, cloneDeep } from 'es-toolkit/object';
import { Session } from "@/model/session";
import { result, template } from "es-toolkit/compat";

interface SpawnConstraints {
    maxCount: number;
    maxDepth: number;
    agentTemplates: AgentTemplate[];
}

export const SpawnInputSchema = z.object({
    template_name: z.string().describe("Name of the agent template to spawn."),
    prompt: z.string().describe("Instructions for the spawned agent."),
}).describe("Specification for a sub-agent to spawn.") satisfies z.ZodTypeAny;

export class Spawn implements Tool<typeof SpawnInputSchema, string> {
    name: string = "spawn";

    get description(): string {
        return "Spawn an new agent based from a existing template (use the template name to specify a template you found with `listAgentTemplates`) and prompt. The agents will keep running until they finish their given tasks, and the results will be returned as tool calling results.";
    }

    inputSchema = SpawnInputSchema;

    constructor(private constraints: SpawnConstraints) { }

    async handler(context: Context, session: Session, input: z.infer<typeof SpawnInputSchema>): Promise<string> {
        const template = clone(this.constraints.agentTemplates.find(t => t.name === input.template_name));
        if (!template) throw new Error(`Agent template ${input.template_name} not found, please check the template_name parameter.`);
        const spawnToolIndex = template.tools.findIndex(tool => tool.name === "spawn");
        if (spawnToolIndex !== -1) {
            if (this.constraints.maxDepth <= 0) {
                // If max depth is reached, remove the spawn tool to prevent further spawning
                template.tools.splice(spawnToolIndex, 1);
            } else {
                // Otherwise, replace it with a new Spawn tool with decreased maxDepth
                template.tools[spawnToolIndex] = new Spawn({
                    maxCount: this.constraints.maxCount,
                    maxDepth: this.constraints.maxDepth - 1,
                    agentTemplates: this.constraints.agentTemplates,
                });
            }
        }
        const newAgent = new Agent(context, template);
        try {
            const result = await newAgent.handleRequest(session, input.prompt);
            return result;
        } catch (error) {
            console.error(`Error in spawned agent ${newAgent.id}:`, error);
            return `Error in spawned agent: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}
