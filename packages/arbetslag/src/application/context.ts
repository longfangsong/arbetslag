import type { ToolExecutingContext } from "./tool/model";
import type { Repository as ToolRepository } from "./tool/repository";
import type { Repository as AIProviderRepository } from "./aiProvider/repository";
import type { OutputRouter } from "./outputRouter/model";

/**
 * The runtime layer shared by the orchestrator and the agents: the tool
 * executing context plus what an agent needs to dispatch its own events
 * (tools, AI provider, output router).
 */
export interface Context extends ToolExecutingContext {
  toolRepository: ToolRepository;
  aiProviderRepository: AIProviderRepository;
  outputRouter: OutputRouter | null;
}
