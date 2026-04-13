import { Agent, AgentTemplate } from "@/model/agent";
import { Context } from "@/model/context";
import { Tool } from "@/model/tool";
import { z } from "zod";
import { cloneDeep } from 'es-toolkit/object';

interface SpawnConstraints {
    maxCount: number;
    maxDepth: number;
    agentTemplates: AgentTemplate[];
}

export const SpawnInputSchema = z.object({
    templateId: z.number().describe("Index of the agent template to spawn."),
    prompt: z.string().describe("Instructions for the spawned agent."),
}).describe("Specification for a sub-agent to spawn.") satisfies z.ZodTypeAny;

export class Spawn implements Tool<typeof SpawnInputSchema, string> {
    name: string = "spawn";
    get description(): string {
        return "Spawn new agent based on provided templates and prompt. The agents will keep running until they finish their given tasks, and the results will be returned as tool calling results.";
    }
    inputSchema = SpawnInputSchema;

    constructor(private constraints: SpawnConstraints) { }

    async handler(context: Context, input: z.infer<typeof SpawnInputSchema>): Promise<string> {
        console.log(`Spawn tool called with input:`, input);
        // const spawnedAgentResults = [];
        // for (const { templateId, prompt } of input) {
        const template = cloneDeep(this.constraints.agentTemplates[input.templateId]);
        if (!template) throw new Error(`Agent template ${input.templateId} not found.`);
        const spawnToolIndex = template.tools.findIndex(tool => tool.name === "spawn");
        if (spawnToolIndex !== -1) {
            (template.tools[spawnToolIndex] as Spawn).constraints.maxDepth = this.constraints.maxDepth - 1;
            if ((template.tools[spawnToolIndex] as Spawn).constraints.maxDepth <= 0) {
                // Remove spawn tool if max depth reached
                template.tools.splice(spawnToolIndex, 1);
            }
        }
        console.log(`Spawning new agent with template '${template.name}' and prompt: ${input.prompt}`);
        const newAgent = new Agent(context, template);
        return await newAgent.handleRequest(input.prompt);
        // }
        // return await Promise.all(spawnedAgentResults);
    }
}
