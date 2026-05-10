import type { LLMAdapter } from "./aiProvider";
import type { FileSystem } from "./fileSystem";
import type { Template } from "./agent";
import type { AgentRepository } from "./agentRepository";
import { runAgent, AgentPaused } from "./workLoop";
import { Mailbox } from "./mailbox";
import { SubscriptionRegistry } from "./subscriptionRegistry";
import { DEFAULT_AGENT_ID_FILE } from "./paths";

/**
 * Message payload for the universal entry point.
 */
export interface IncomingMessage {
  /** Target agent ID. If null/undefined, routes to the default agent. */
  agentId?: string | null;
  /** The message content (will be serialized to string). */
  content: unknown;
}

/**
 * The orchestrator for the actor-based event loop.
 *
 * Each agent has a mailbox. On each invocation, the agent wakes up,
 * dequeues one message, runs its full tool-call loop, saves state,
 * and goes back to sleep.
 *
 * NOTE: No concurrency control. If two invocations hit the same
 * agent's mailbox simultaneously (e.g., two webhook calls), they
 * may process the same message or overwrite each other's writes.
 * For production use, add optimistic concurrency control (version
 * field) or file locking. See code-smells.md #10.
 */
export class AgentRunner {
  private defaultAgentId: string | null = null;
  private readonly subscriptionRegistry: SubscriptionRegistry;

  constructor(
    private readonly adapters: Array<LLMAdapter>,
    private readonly tools: Array<any>,
    private readonly fileSystem: FileSystem,
    private readonly agentTemplates: Array<Template>,
    private readonly config: Record<string, any>,
    private readonly agentRepository: AgentRepository,
  ) {
    this.subscriptionRegistry = new SubscriptionRegistry(fileSystem);
  }

  /**
   * Universal entry point.
   *
   * Loads agent, processes one message, saves state.
   *
   * If agentId is null, routes to the default agent.
   */
  async handleMessage(input: IncomingMessage): Promise<void> {
    const agentId = input.agentId
      ? input.agentId
      : await this.#getDefaultAgentId();

    // Load or create agent
    const msgContext = {
      adapters: this.adapters,
      tools: this.tools,
      fileSystem: this.fileSystem,
      agentTemplates: this.agentTemplates,
      config: this.config,
      agentRepository: this.agentRepository,
      agentRunner: this,
    };
    let agent = await this.agentRepository.load(agentId, msgContext);
    if (!agent) {
      const template = this.agentTemplates.find((t) => t.isDefault);
      if (!template) {
        throw new Error(
          `No default template found. Cannot create agent '${agentId}'.`,
        );
      }
      agent = await this.agentRepository.create(template, msgContext);
    }

    // Run the work loop — runAgent injects initialPayload into history
    try {
      const content =
        typeof input.content === "string"
          ? input.content
          : JSON.stringify(input.content);
      await runAgent({
        adapters: this.adapters,
        tools: this.tools,
        fileSystem: this.fileSystem,
        agentTemplates: this.agentTemplates,
        config: this.config,
        agentRepository: this.agentRepository,
      agentRunner: this,
      }, agent, content);
    } catch (error) {
      if (!(error instanceof AgentPaused)) {
        throw error;
      }
    }
  }

  /**
   * Emit an event. Routes to all type subscribers (SubscriptionRegistry).
   * Messages are enqueued to recipients' mailboxes.
   * Returns the number of recipients notified.
   *
   * Note: Mailbox is a thin wrapper around a file path + FileSystem.
   * Creating a new instance per call is intentional — it's lightweight
   * and keeps each method self-contained. See code-smells.md #7.
   */
  async emitEvent(eventType: string, data?: unknown): Promise<number> {
    let count = 0;
    const content =
      typeof data === "string" ? data : JSON.stringify(data);

    const subscribers = await this.subscriptionRegistry.getSubscribers(eventType);
    for (const subAgentId of subscribers) {
      const mailbox = new Mailbox(this.fileSystem, subAgentId);
      await mailbox.enqueue({
        content,
        eventType,
      });
      count++;
    }

    return count;
  }

  /**
   * Spawn a new agent from template, enqueue startup message,
   * process its first turn, return agentId. Fire-and-forget.
   */
  async spawn(templateName: string, prompt: string): Promise<string> {
    const template = this.agentTemplates.find((t) => t.name === templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found.`);
    }

    const context = {
      adapters: this.adapters,
      tools: this.tools,
      fileSystem: this.fileSystem,
      agentTemplates: this.agentTemplates,
      config: this.config,
      agentRepository: this.agentRepository,
      agentRunner: this,
    };

    const agent = await this.agentRepository.create(template, context);

    // Enqueue startup message
    const mailbox = new Mailbox(this.fileSystem, agent.id);
    await mailbox.enqueue({ content: prompt });

    // Process first turn — runAgent injects prompt into history
    await mailbox.dequeue();

    try {
      await runAgent(context, agent, prompt);
    } catch (error) {
      if (!(error instanceof AgentPaused)) {
        throw error;
      }
    }

    return agent.id;
  }

  /**
   * Get or create the default agent ID.
   * Persists the ID to disk so it survives restarts.
   */
  async #getDefaultAgentId(): Promise<string> {
    if (this.defaultAgentId) return this.defaultAgentId;

    // Try to load from disk
    try {
      const raw = await this.fileSystem.readFile(DEFAULT_AGENT_ID_FILE);
      this.defaultAgentId = raw;
      return this.defaultAgentId;
    } catch {
      // No persisted default agent — create one
    }

    const template = this.agentTemplates.find((t) => t.isDefault);
    if (!template) {
      throw new Error(
        `No default template found. Cannot create default agent.`,
      );
    }

    const context = {
      adapters: this.adapters,
      tools: this.tools,
      fileSystem: this.fileSystem,
      agentTemplates: this.agentTemplates,
      config: this.config,
      agentRepository: this.agentRepository,
      agentRunner: this,
    };

    const agent = await this.agentRepository.create(template, context);
    this.defaultAgentId = agent.id;
    await this.fileSystem.writeFile(
      DEFAULT_AGENT_ID_FILE,
      this.defaultAgentId,
    );
    return this.defaultAgentId;
  }
}
