import z from "zod";
import { Agent, Template } from "../agent";
import { Tool } from ".";
import { Context } from "../context";
import { Session } from "../session";
import cloneDeep from "es-toolkit/compat/cloneDeep";

export const ListTemplatesInputSchema = z.object({}) satisfies z.ZodTypeAny;

export class ListTemplates implements Tool<
  typeof ListTemplatesInputSchema,
  Array<{ name: string; description: string }>
> {
  static name: string = "listAgentTemplates";
  description = "List all available agent templates in the system.";
  inputSchema = ListTemplatesInputSchema;
  constructor() {}

  async handler(
    context: Context,
    session: Session,
    input: Record<string, never>,
  ): Promise<Array<{ name: string; description: string }>> {
    return context.agentTemplates.map((template) => ({
      name: template.name,
      description: template.description,
    }));
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
  static name: string = "spawn";
  description: string =
    "Spawn an new agent based from a existing template (use the template name to specify a template you found with `listAgentTemplates`) and prompt. The agents will keep running on its own until they finish their given tasks, you will get the id of the spawned agent, with it you can use `await` tool to wait for it to complete and get the result.";
  inputSchema = SpawnInputSchema;

  private constraints: SpawnConstraints;

  constructor(constraints: SpawnConstraints) {
    this.constraints = constraints;
  }

  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof SpawnInputSchema>,
  ): Promise<string> {
    const template = cloneDeep(context.getTemplate(input.template_name));
    if (!template) {
      throw new Error(
        `Agent template ${input.template_name} not found, please check the template_name parameter.`,
      );
    }
    const spawnToolIndex = template.tools.findIndex(
      (tool) => tool.name === Spawn.name,
    );
    if (spawnToolIndex !== -1) {
      template.tools[spawnToolIndex] = {
        name: Spawn.name,
        metaParameters: {
          maxDepth: this.constraints.maxDepth - 1,
        },
      };
      if (this.constraints.maxDepth <= 0) {
        // If max depth is reached, remove the spawn tool to prevent further spawning
        template.tools.splice(spawnToolIndex, 1);
      }
    }

    const newAgent = new Agent(context, template);
    newAgent.handleRequest(context, session, input.prompt);
    return newAgent.id;
  }
}

export const AwaitInputSchema = z
  .object({
    agent_id: z.string().describe("ID of the spawned agent to await."),
  })
  .describe(
    "Wait for a spawned agent to complete and return its result.",
  ) satisfies z.ZodTypeAny;

export class Await implements Tool<typeof AwaitInputSchema, string> {
  static name: string = "await";
  description: string =
    "Wait for a spawned agent to complete. Returns the result of the agent's execution.";
  inputSchema = AwaitInputSchema;

  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof AwaitInputSchema>,
  ): Promise<string> {
    const agent = session.agents.find((a) => a.id === input.agent_id);
    if (!agent) {
      throw new Error(`Agent ${input.agent_id} not found.`);
    }
    if (!agent.workingOn) {
      throw new Error(`Agent ${input.agent_id} has no pending request.`);
    }
    return agent.workingOn;
  }
}
