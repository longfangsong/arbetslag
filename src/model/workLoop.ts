import { Agent } from "./agent";
import { Context } from "./context";
import { AssistantMessage } from "./aiProvider";

export class AgentPaused extends Error {
  constructor() {
    super("Agent paused");
  }
}

/**
 * The single entry point that drives an agent one turn at a time.
 *
 * Flow:
 * 1. If `initialPayload` is provided, inject it as the first user message
 * 2. Call `adapter.call()` to get one assistant turn
 * 3. If the response contains tool calls, execute them and loop back
 * 4. If `metaAction: "pause"` is in any tool result, save state and throw `AgentPaused`
 * 5. Save state after each turn for crash recovery
 * 6. Return when no tool calls remain (agent done) or max iterations reached
 */
export async function runAgent(
  context: Context,
  agent: Agent,
  initialPayload?: string,
): Promise<void> {
  const adapter = agent.adapter;
  const toolDefs = adapter.buildToolDefs(agent.tools);

  // Inject initial payload as first user message if provided
  if (initialPayload) {
    agent.history.push({ role: "user", content: initialPayload });
  }

  let iteration = 0;
  while (iteration < 128) {
    iteration++;

    // Single API call — returns one assistant message (may contain tool calls)
    const assistantMessage: AssistantMessage =
      await adapter.call(agent.history, toolDefs, agent.model);
    agent.history.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // No tool calls — done
      await context.agentRepository.save(agent);
      return;
    }

    // Execute each tool call
    for (const toolCall of toolCalls) {
      try {
        const toolName = adapter.getToolName(toolCall);
        const tool = agent.tools.find(
          t => (t.constructor as unknown as { toolName: string }).toolName === toolName,
        );
        if (!tool) {
          throw new Error(`Tool '${toolName}' not found.`);
        }
        const rawArgs = adapter.getToolArguments(toolCall);
        const args = adapter.parseToolArguments(tool, rawArgs);
        const toolResult = await tool.handler(context, agent.id, args);

        // Check for metaAction: "pause" in tool result
        if (
          typeof toolResult === "object" &&
          toolResult !== null &&
          "metaAction" in toolResult &&
          (toolResult as { metaAction: string }).metaAction === "pause"
        ) {
          // Save state before pausing
          await context.agentRepository.save(agent);
          throw new AgentPaused();
        }

        // Push tool result message to history
        if (toolResult !== undefined) {
          agent.history.push(adapter.createToolMessage(toolCall, toolResult));
        }
      } catch (error) {
        const toolName = (toolCall as { function: { name: string } }).function?.name ?? "unknown";
        agent.history.push(
          adapter.createToolMessage(toolCall, `Error executing tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    }

    // Save state after each turn for crash recovery
    await context.agentRepository.save(agent);
  }

  await context.agentRepository.save(agent);
}
