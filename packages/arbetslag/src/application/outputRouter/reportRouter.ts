import { ok, type Result } from "neverthrow";
import { hasToolCalls } from "../agent/history";
import type { Repository as AgentRepository } from "../agent/repository";
import { openWait, WAIT_TOOL_NAME } from "../agent/report";
import type { EventBus } from "../event/bus";
import type { AgentOutput, Event } from "../event/event";
import type { Compacted, OutputRouter } from "./model";

/**
 * The output router of an agent that has a Creator: it never speaks to a user,
 * so its output goes to the Creator — a turn-ending output (its Report) answers
 * the open Wait that names it. Nothing is stored here; the Report lives in the
 * agent's history, so an output with no open Wait is simply held.
 *
 * It writes to the bus directly, so the other routers (which only deliver to a
 * channel) do not have to return events.
 */
export class ReportRouter implements OutputRouter {
  constructor(
    private readonly agentId: string,
    private readonly agents: AgentRepository,
    private readonly bus: EventBus,
  ) {}

  async route(event: AgentOutput | Compacted): Promise<Result<void, string>> {
    if ("kind" in event) return ok(undefined); // no user to notify
    const agent = await this.agents.getById(this.agentId);
    const creatorId = agent?.createdByAgentId;
    if (!agent || !creatorId) return ok(undefined);
    // Mid-turn content (an assistant entry with tool calls) is not a Report.
    if (hasToolCalls(agent.history[agent.history.length - 1])) return ok(undefined);
    const creator = await this.agents.getById(creatorId);
    const wait = creator ? openWait(creator.history, agent.id) : undefined;
    if (!creator || !wait) return ok(undefined);
    this.bus.push({
      id: wait.id,
      event_type: "tool_call_response",
      to_agent_id: creator.id,
      name: WAIT_TOOL_NAME,
      content: JSON.stringify(event.content),
    });
    return ok(undefined);
  }
}
