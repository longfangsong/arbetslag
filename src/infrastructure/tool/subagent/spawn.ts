import { State } from "@/application/orchestrator";
import { Agent } from "@/domain/agent/model";

import { Tool } from "@/domain/tool/model";
import { err, ok, Result } from "neverthrow";
import z from "zod";
import { nanoid } from "nanoid";
import { createAgent } from "@/domain/agent/template/model";

export const SpawnInputSchema = z
  .object({
    template_name: z.string().describe("Name of the agent template to spawn."),
    prompt: z.string().describe("Instructions for the spawned agent."),
  })
  .describe("Specification for a sub-agent to spawn.") satisfies z.ZodTypeAny;

export class Spawn implements Tool<z.infer<typeof SpawnInputSchema>, string, string> {
    name: string = "spawn";
    description: string = "Spawn a new agent based on a specified template and prompt.";
    inputSchema = SpawnInputSchema;

    async call(state: State, caller: Agent, input: z.infer<typeof SpawnInputSchema>): Promise<Result<string, string>> {
        const template = await state.agentTemplateRepository.getByName(input.template_name);
        if (!template) {
            return Promise.resolve(err(`Template ${input.template_name} not found.`));
        }
        const newAgent = createAgent(template, input.prompt);
        await state.agentRepository.add(newAgent);
        (state.toolState['parent_agent'] as Map<string, string>).set(newAgent.id, caller.id);
        state.eventQueue.push({
            id: nanoid(10),
            chat_id: String(caller.id),
            adapter: "plain",
            event_type: "message",
            payload: { content: input.prompt },
        });
        return Promise.resolve(ok(newAgent.id));
    }
}
