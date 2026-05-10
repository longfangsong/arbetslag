import z from "zod";
import type { Template } from "../agent";
import { Tool, ok, err } from ".";
import { Result } from "neverthrow";
import { Context } from "../context";
import cloneDeep from "es-toolkit/compat/cloneDeep";

export const ListTemplatesInputSchema = z.object({}) satisfies z.ZodTypeAny;

export class ListTemplates implements Tool<
  typeof ListTemplatesInputSchema,
  Array<{ name: string; description: string }>
> {
  static toolName: string = "listAgentTemplates";
  description = "List all available agent templates in the system.";
  inputSchema = ListTemplatesInputSchema;
  constructor() {}

  async handler(
    context: Context,
    _agentId: string,
    input: Record<string, never>,
  ): Promise<Result<Array<{ name: string; description: string }>, string>> {
    return ok(context.agentTemplates.map((template) => ({
      name: template.name,
      description: template.description,
    })));
  }
}

export interface SpawnConstraints {
  maxDepth: number;
}

export const SpawnInputSchema = z
  .object({
    template_name: z.string().describe("Name of the agent template to spawn."),
    prompt: z.string().describe("Instructions for the spawned agent."),
  })
  .describe("Specification for a sub-agent to spawn.") satisfies z.ZodTypeAny;

export class Spawn implements Tool<typeof SpawnInputSchema, string> {
  static toolName: string = "spawn";
  description: string =
    "Spawn a new agent based on an existing template (use the template name to specify a template you found with `listAgentTemplates`) and prompt. The agent will run asynchronously and process its mailbox.";
  inputSchema = SpawnInputSchema;

  private constraints: SpawnConstraints;

  constructor(constraints: SpawnConstraints) {
    this.constraints = constraints;
  }

  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof SpawnInputSchema>,
  ): Promise<Result<string, string>> {
    const template = cloneDeep(context.agentTemplates.find((t) => t.name === input.template_name));
    if (!template) {
      return err(
        `Agent template ${input.template_name} not found, please check the template_name parameter.`,
      );
    }
    const spawnToolIndex = template.tools.findIndex(
      (tool) => tool.name === Spawn.toolName,
    );
    if (spawnToolIndex !== -1) {
      template.tools[spawnToolIndex] = {
        name: Spawn.toolName,
        metaParameters: {
          maxDepth: this.constraints.maxDepth - 1,
        },
      };
      if (this.constraints.maxDepth <= 0) {
        // If max depth is reached, remove the spawn tool to prevent further spawning
        template.tools.splice(spawnToolIndex, 1);
      }
    }

    const agentId = await context.agentRunner.spawn(
      input.template_name,
      input.prompt,
    );

    return ok(agentId);
  }
}
