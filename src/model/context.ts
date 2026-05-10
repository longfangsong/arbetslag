import type { AgentRepository } from "./agentRepository";
import type { LLMAdapter } from "./aiProvider";
import type { Tool } from "./tool";
import type { FileSystem } from "./fileSystem";
import type { Template } from "./agent";
import { AgentRunner } from "./agentRunner";

export type NamedToolCtor = new (...args: any[]) => Tool<any, any> & { toolName: string };

export type Context = {
  adapters: Array<LLMAdapter>;
  tools: Array<any>;
  fileSystem: FileSystem;
  agentTemplates: Array<Template>;
  config: Record<string, any>;
  agentRepository: AgentRepository;
  agentRunner: AgentRunner;
};

/**
 * Create a Context and AgentRunner together.
 * Returns both the Context type and the AgentRunner instance.
 */
export function createRuntime(
  adapters: Array<LLMAdapter>,
  tools: Array<any>,
  fileSystem: FileSystem,
  agentTemplates: Array<Template>,
  config: Record<string, any>,
  agentRepository: AgentRepository,
): { context: Context; agentRunner: AgentRunner } {
  // Create AgentRunner first (it doesn't need Context anymore)
  const agentRunner = new AgentRunner(
    adapters,
    tools,
    fileSystem,
    agentTemplates,
    config,
    agentRepository,
  );

  // Then create Context with agentRunner reference
  const context: Context = {
    adapters,
    tools,
    fileSystem,
    agentTemplates,
    config,
    agentRepository,
    agentRunner,
  };

  return { context, agentRunner };
}
