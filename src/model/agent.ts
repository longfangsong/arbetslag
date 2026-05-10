import { nanoid } from "nanoid";
import { Context } from "./context";
import { Tool } from "./tool";
import type { LLMAdapter } from "./aiProvider";

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
  /** When true, this template is used for the default agent (single instance). */
  isDefault?: boolean;
}

export class Agent {
  readonly id: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly toolNames: string[];
  public tools: Array<Tool<any, any>>;
  public adapter: LLMAdapter;
  readonly adapterName: string;
  history: unknown[] = [];

  constructor(context: Context, template: Template) {
    this.id = nanoid(10);
    this.model = template.model;
    this.systemPrompt = template.systemPrompt;
    this.toolNames = template.tools.map((t) => t.name);
    this.adapterName = template.provider;
    this.adapter = context.adapters.find((a) => a.name === template.provider)!;
    this.tools = [];

    for (const toolConfig of template.tools) {
      const ToolConstructor = context.tools.find(
        (t) => (t as unknown as { toolName: string }).toolName === toolConfig.name,
      );
      if (!ToolConstructor) {
        console.warn(`Tool constructor not found for tool: ${toolConfig.name}`);
        continue;
      }
      const metaParams = toolConfig.metaParameters || {};
      const toolInstance = new ToolConstructor(metaParams);
      this.tools.push(toolInstance);
    }
  }

  toJson(): string {
    return JSON.stringify({
      id: this.id,
      model: this.model,
      adapter: this.adapterName,
      systemPrompt: this.systemPrompt,
      toolNames: this.toolNames,
      history: this.history,
    });
  }

  static fromJson(context: Context, json: string): Agent {
    const state = JSON.parse(json);
    const adapter = context.adapters.find((a) => a.name === state.adapter);
    if (!adapter) {
      throw new Error(
        `Adapter '${state.adapter}' not found. Available: ${context.adapters.map((a) => a.name).join(', ')}.`,
      );
    }

    const agent = Object.create(Agent.prototype);
    agent.id = state.id;
    agent.model = state.model;
    agent.adapterName = state.adapter;
    agent.adapter = adapter;
    agent.systemPrompt = state.systemPrompt;
    agent.toolNames = state.toolNames;
    agent.tools = state.toolNames.map((name: string) => {
      const ToolConstructor = context.tools.find(
        (t) => (t as unknown as { toolName: string }).toolName === name,
      );
      if (ToolConstructor) {
        return new ToolConstructor();
      }
      console.warn(`Tool constructor not found for tool: ${name}`);
      return undefined!;
    }).filter((t: Tool<any, any> | undefined) => t !== undefined);
    agent.history = state.history ?? [];
    return agent;
  }

}
