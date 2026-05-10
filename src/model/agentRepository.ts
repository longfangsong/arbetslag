import { Agent, type Template } from "./agent";
import type { Context } from "./context";
import type { FileSystem } from "./fileSystem";
import { InMemoryFileSystem } from "./fileSystem/inMemory";

/**
 * DDD Repository for Agent persistence.
 * Agent owns its state; repository handles save/load.
 */
export interface AgentRepository {
  /** Save agent state (including conversation history) to storage. */
  save(agent: Agent): Promise<void>;

  /**
   * Load a previously persisted agent by ID.
   * Returns null if no persisted state is found.
   */
  load(agentId: string, context: Context): Promise<Agent | null>;

  /**
   * Load raw persisted state (without reconstructing the Agent).
   * Returns null if no persisted state is found.
   */
  loadState(agentId: string): Promise<string | null>;

  /**
   * Create a new agent from a template and persist it immediately.
   */
  create(template: Template, context: Context): Promise<Agent>;
}

/**
 * In-memory agent repository for testing.
 */
export class InMemoryAgentRepository implements AgentRepository {
  private agents: Map<string, string> = new Map();

  async save(agent: Agent): Promise<void> {
    this.agents.set(agent.id, agent.toJson());
  }

  async load(
    agentId: string,
    context: Context,
  ): Promise<Agent | null> {
    const json = this.agents.get(agentId);
    if (!json) return null;
    return Agent.fromJson(context, json);
  }

  async loadState(
    agentId: string,
  ): Promise<string | null> {
    return this.agents.get(agentId) ?? null;
  }

  async create(
    template: Template,
    context: Context,
  ): Promise<Agent> {
    const agent = new Agent(context, template);
    await this.save(agent);
    return agent;
  }
}

/**
 * File-based agent repository that persists agent state to JSON files.
 * State files are stored as `run/{agentId}.json`.
 */
export class FileAgentRepository implements AgentRepository {
  private readonly fs: FileSystem;

  constructor(fs?: FileSystem) {
    this.fs = fs ?? new InMemoryFileSystem();
  }

  async save(agent: Agent): Promise<void> {
    const statePath = this.#statePath(agent.id);
    await this.fs.writeFile(statePath, agent.toJson());
  }

  async load(
    agentId: string,
    context: Context,
  ): Promise<Agent | null> {
    const state = await this.loadState(agentId);
    if (!state) return null;
    return Agent.fromJson(context, state);
  }

  async loadState(
    agentId: string,
  ): Promise<string | null> {
    const statePath = this.#statePath(agentId);
    try {
      return await this.fs.readFile(statePath);
    } catch {
      return null;
    }
  }

  async create(
    template: Template,
    context: Context,
  ): Promise<Agent> {
    const agent = new Agent(context, template);
    await this.save(agent);
    return agent;
  }

  #statePath(agentId: string): string {
    return `run/${agentId}.json`;
  }
}
