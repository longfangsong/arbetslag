import { ok, err, Result } from "neverthrow";
import { EventBus } from "./event/bus";
import { Event } from "./event/event";
import { unwrap } from "../utils";
import { Agent } from "./agent/model";
import type { Context } from "./context";
import createDebug from "debug";

const orchLog = createDebug("arbetslag:orchestrator");

export type OrchestratorDeps = Omit<Context, "eventBus">;

export class Orchestrator {
  private readonly bus = new EventBus();
  private readonly context: Context;

  constructor(deps: OrchestratorDeps) {
    this.context = { ...deps, eventBus: this.bus };
  }

  push(event: Event) {
    this.bus.push(event);
  }

  empty(): boolean {
    return this.bus.empty();
  }

  async step(): Promise<Result<void, string>> {
    const event = this.bus.pop();
    if (event) return this.dispatch(event);
    // Nothing on the bus: an agent may still hold pending events (e.g. its queue
    // was restored from a checkpoint), so drain whichever agent is not idle.
    for (const agent of await this.context.agentRepository.list()) {
      if (!agent.idle()) return this.run(agent);
    }
    return ok(undefined);
  }

  /** Step until the bus is empty and every agent's own queue is empty. */
  async stepUntilIdle(maxIterations = 1024): Promise<Result<void, string>> {
    let iterations = 0;
    while (!(await this.idle()) && iterations < maxIterations) {
      const result = await this.step();
      if (result.isErr()) return err(result.error);
      iterations++;
    }
    if (!(await this.idle())) {
      const pendingAgents = (await this.context.agentRepository.list()).filter((a) => !a.idle()).length;
      orchLog(`stopped at maxIterations=${maxIterations}, ${this.bus.queue.length} event(s) on the bus, ${pendingAgents} agent(s) with pending events`);
    }
    return ok(undefined);
  }

  private async idle(): Promise<boolean> {
    if (!this.bus.empty()) return false;
    for (const agent of await this.context.agentRepository.list()) {
      if (!agent.idle()) return false;
    }
    return true;
  }

  /** Deliver the event to the agent it belongs to — that agent dispatches it from its own queue. */
  private async dispatch(event: Event): Promise<Result<void, string>> {
    orchLog(`deliver ${event.event_type} id=${event.id}`);
    const agent = await this.resolveAgent(event);
    if (!agent) return err(`no agent for event ${event.event_type} id=${event.id}`);
    agent.push(event);
    return this.run(agent);
  }

  private async run(agent: Agent): Promise<Result<void, string>> {
    const produced = await agent.dispatch(this.context);
    if (produced.isErr()) return err(produced.error);
    await this.context.agentRepository.save(agent);
    for (const event of produced.value) {
      this.bus.push(event);
    }
    return ok(undefined);
  }

  private async resolveAgent(event: Event): Promise<Agent | null> {
    const { agentRepository, templateRepository } = this.context;

    if (event.event_type === "message" || event.event_type === "compact_request") {
      const agent = await agentRepository.getByChatId(event.chat_id);
      if (agent) return agent;
      // a missing default template is a configuration error —
      // the one place we still throw (crash, don't silently misroute).
      const template = unwrap(await templateRepository.default());
      const entryAgent = Agent.create(template);
      entryAgent.chatId = event.chat_id;
      await agentRepository.setEntryAgent(event.chat_id, entryAgent);
      return entryAgent;
    }

    let agentId: string | undefined;
    if ("to_agent_id" in event) {
      agentId = event.to_agent_id;
    } else if ("from_agent_id" in event) {
      agentId = event.from_agent_id;
    }
    if (!agentId) return null;
    return agentRepository.getById(agentId);
  }
}
