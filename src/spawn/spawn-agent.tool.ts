/**
 * spawn_agent Built-In Tool
 * 
 * Allows agents to spawn child agents to delegate tasks
 * 
 * Usage constraints enforced:
 * - maxCount: max # of concurrent child agents
 * - maxDepth: max nesting depth (parent maxDepth > 0 to spawn)
 * - allowedTypes: whitelist of allowed child agent configs ([] = any)
 */

import { Tool, AgentConfig, SpawnConstraints } from '../types';
import { AgentFactory } from '../core/factory';
import { AgentSession } from './session-manager';
import { logger } from '../observability/logger';
import { BaseAIProvider } from '../providers/base';

export interface SpawnAgentInput {
  config: AgentConfig;
  parentConstraints: SpawnConstraints;
  currentDepth: number;
}

export interface SpawnAgentResult {
  sessionId: string;
  agentId: string;
  status: 'created';
  error?: never;
}

export interface SpawnAgentError {
  sessionId?: never;
  agentId?: never;
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}

export type SpawnAgentResponse = SpawnAgentResult | SpawnAgentError;

/**
 * Create the spawn_agent built-in tool
 * 
 * This tool requires the parent agent to pass its own constraints
 * and the provider registry so we can instantiate children
 */
export function createSpawnAgentTool(
  parentConstraints: SpawnConstraints,
  currentDepth: number,
  providerRegistry: Map<string, new (config: any) => BaseAIProvider>
): Tool {
  return {
    name: 'spawn_agent',
    description: 'Spawn a child agent to delegate tasks. Pass config, tools, and provider.',
    schema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          description: 'Provider name (e.g., "ollama", "gemini")',
        },
        providerConfig: {
          type: 'object',
          description: 'Provider-specific configuration (API keys, model names, etc.)',
        },
        tools: {
          type: 'array',
          description: 'Tools available to the child agent',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              schema: { type: 'object' },
              handler: { type: 'string', description: 'Handler function (stringified for serialization)' },
            },
            required: ['name', 'description', 'schema'],
          },
        },
        spawnConstraints: {
          type: 'object',
          description: 'Constraints for this child agent to apply when it spawns further children',
          properties: {
            maxCount: { type: 'number' },
            maxDepth: { type: 'number' },
            allowedTypes: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['provider', 'providerConfig'],
    },
    handler: async (input: any): Promise<SpawnAgentResponse> => {
      try {
        return await spawnAgentHandler(
          input,
          parentConstraints,
          currentDepth,
          providerRegistry
        );
      } catch (error: any) {
        logger.error('spawn_agent tool error', {
          error: error.message,
          code: error.code,
        });

        return {
          status: 'error',
          error: {
            code: error.code || 'SPAWN_ERROR',
            message: error.message,
          },
        };
      }
    },
  };
}

/**
 * Handler for spawn_agent tool
 */
async function spawnAgentHandler(
  input: any,
  parentConstraints: SpawnConstraints,
  parentDepth: number,
  providerRegistry: Map<string, new (config: any) => BaseAIProvider>
): Promise<SpawnAgentResult | SpawnAgentError> {
  logger.debug('spawn_agent handler called', {
    provider: input.provider,
    parentDepth,
    parentConstraints,
  });

  // 1. Validate spawn constraints BEFORE creating child
  const childDepth = parentDepth + 1;

  try {
    AgentSession.validateSpawnConstraints(
      parentConstraints,
      parentDepth,
      0 // We're at max 1 child spawn in this call; parent tracks active count
    );
  } catch (error: any) {
    logger.warn('Spawn constraint violation', { error: error.message });
    return {
      status: 'error',
      error: {
        code: error.code || 'SPAWN_CONSTRAINT_VIOLATED',
        message: error.message,
      },
    };
  }

  // 2. Validate provider is available
  const ProviderClass = providerRegistry.get(input.provider);
  if (!ProviderClass) {
    const error = new Error(`Provider not found: "${input.provider}"`);
    (error as any).code = 'PROVIDER_NOT_FOUND';
    throw error;
  }

  // 3. Instantiate provider
  let provider: BaseAIProvider;
  try {
    provider = new ProviderClass(input.providerConfig);
  } catch (error: any) {
    const msg = `Failed to instantiate provider: ${error.message}`;
    (error as any).code = 'PROVIDER_INSTANTIATION_FAILED';
    throw error;
  }

  // 4. Apply spawn constraints defaults to child
  const childConstraints: SpawnConstraints = {
    maxCount: input.spawnConstraints?.maxCount ?? 100,
    maxDepth: input.spawnConstraints?.maxDepth ?? 10,
    allowedTypes: input.spawnConstraints?.allowedTypes ?? [],
  };

  // 5. Create child agent via factory
  const childConfig: AgentConfig = {
    provider: input.provider,
    providerConfig: input.providerConfig,
    tools: input.tools || [],
    spawnConstraints: childConstraints,
  };

  let childAgent;
  try {
    const factory = new AgentFactory(childConfig, provider);
    childAgent = await factory.build();
  } catch (error: any) {
    logger.error('Failed to create child agent', {
      error: error.message,
      provider: input.provider,
    });
    throw error;
  }

  // 6. Create and return session
  const session = new AgentSession({
    agent: childAgent,
    parentId: undefined, // Parent agent ID should be passed separately if needed
    currentDepth: childDepth,
  });

  logger.debug('spawn_agent succeeded', {
    sessionId: session.sessionId,
    agentId: childAgent.state.id,
    depth: childDepth,
  });

  return {
    sessionId: session.sessionId,
    agentId: childAgent.state.id,
    status: 'created',
  };
}
