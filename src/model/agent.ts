import { nanoid } from "nanoid";
import { Context } from "./context";
import { Tool } from "./tool";
import { Session } from "./session";
import { AIProvider } from "./aiProvider";
import { FileSystem } from "./fileSystem";

export interface ToolConfig {
  name: string;
  metaParameters?: Record<string, any>;
}

export interface Template {
  name: string;
  description: string;
  provider: string;
  model: string;
  systemPrompt: string;
  tools: ToolConfig[];
}

export interface AgentState {
  id: string;
  model: string;
  provider: string;
  systemPrompt: string;
  toolNames: string[];
  history: unknown[];
}

export class Agent {
  readonly id: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly toolNames: string[];
  workingOn: Promise<string> | null = null;
  public tools: Array<Tool<any, any>>;
  private provider: AIProvider;

  constructor(context: Context, template: Template) {
    this.id = nanoid(10);
    this.model = template.model;
    this.systemPrompt = template.systemPrompt;
    this.toolNames = template.tools.map((t) => t.name);
    this.provider = context.getAIProvider(template.provider)!;
    this.tools = [];

    for (const toolConfig of template.tools) {
      const ToolConstructor = context.getToolConstructor(toolConfig.name);
      if (!ToolConstructor) {
        console.warn(`Tool constructor not found for tool: ${toolConfig.name}`);
        continue;
      }
      const metaParams = toolConfig.metaParameters || {};
      const toolInstance = new ToolConstructor(metaParams);
      this.tools.push(toolInstance);
    }
  }

  private static createFromState(
    id: string,
    model: string,
    provider: AIProvider,
    systemPrompt: string,
    toolNames: string[],
    tools: Array<Tool<any, any>>,
  ): Agent {
    const agent = Object.create(Agent.prototype);
    agent.id = id;
    agent.model = model;
    agent.provider = provider;
    agent.systemPrompt = systemPrompt;
    agent.toolNames = toolNames;
    agent.tools = tools;
    agent.workingOn = null;
    return agent;
  }

  async handleRequest(
    context: Context,
    session: Session,
    message: string,
  ): Promise<string> {
    session.currentAgentId = this.id;
    if (!session.agents.includes(this)) {
      session.addAgent(this);
    }
    this.workingOn = this.provider.sendMessage(context, session, this, message);
    return this.workingOn!;
  }

  async recordState(sessionId: string, messages: unknown[], fs: FileSystem): Promise<void> {
    const state: AgentState = {
      id: this.id,
      model: this.model,
      provider: this.provider.name,
      systemPrompt: this.systemPrompt,
      toolNames: this.toolNames,
      history: messages,
    };
    await fs.writeFile(`run/${sessionId}/${this.id}.json`, JSON.stringify(state));
  }

  static async resumeFromFile(
    context: Context,
    statePath: string,
    eventMessage: unknown,
  ): Promise<string> {
    const fs = context.fileSystem;
    const raw = await fs.readFile(statePath);
    const state: AgentState = JSON.parse(raw);

    // Reconstruct provider and tools from context
    const provider = context.getAIProvider(state.provider)!;
    const tools: Array<Tool<any, any>> = [];
    for (const toolName of state.toolNames) {
      const ToolConstructor = context.getToolConstructor(toolName);
      if (ToolConstructor) {
        tools.push(new ToolConstructor());
      }
    }

    // Reconstruct agent with loaded state
    const agent = Agent.createFromState(
      state.id,
      state.model,
      provider,
      state.systemPrompt,
      state.toolNames,
      tools,
    );

    // Inject event into history
    state.history.push(eventMessage);

    // Continue the loop
    const session = new Session({ prompt: "" });
    return agent.provider.sendMessage(context, session, agent, "", state.history);
  }
}
