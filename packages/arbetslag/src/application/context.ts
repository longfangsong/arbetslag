import type { ToolExecutingContext } from "./tool/model";
import type { Repository as ToolRepository } from "./tool/repository";
import type { Repository as AIProviderRepository } from "./aiProvider/repository";
import type { OutputRouterRegistry } from "./outputRouter/registry";

/**
 * The runtime layer the Orchestrator executes external-capability events
 * against (AI provider, tools, output routers) — the same layer tools run in.
 * Agents no longer need it: they only change their own state.
 */
export interface Context extends ToolExecutingContext {
  toolRepository: ToolRepository;
  aiProviderRepository: AIProviderRepository;
  /** Rebuilds each agent's own OutputRouter when it is loaded. */
  outputRouterRegistry: OutputRouterRegistry;
}
