/**
 * AgentFactory - Builder for creating agents from config
 * 
 * Responsibilities:
 * - Validate agent configuration
 * - Instantiate and authenticate AI provider (fail-fast)
 * - Validate tool definitions (no duplicates)
 * - Apply spawn constraint defaults
 * - Create and return Agent instance
 */

import { Agent } from './agent';
import { AgentConfig, Tool, SpawnConstraints } from '../types';
import { BaseAIProvider } from '../providers/base';
import { validateSpawnConstraints } from './spawn-constraints';
import { logger } from '../observability/logger';

export interface FactoryConfig {
  config: AgentConfig;
  provider: BaseAIProvider;
}

export class AgentFactory {
  private config: AgentConfig;
  private provider: BaseAIProvider;

  constructor(config: AgentConfig, provider: BaseAIProvider) {
    this.config = config;
    this.provider = provider;
  }

  /**
   * Build and return an instantiated agent
   * Throws on validation failure or provider connectivity issues
   */
  async build(): Promise<Agent> {
    logger.debug('AgentFactory.build() starting', { config: this.config });

    try {
      // 1. Validate provider connectivity (fail-fast, per FR-001a)
      await this.provider.authenticate();
      logger.debug('Provider authenticated successfully');

      // 2. Validate tools (no duplicates per FR-003b)
      this.validateTools(this.config.tools);
      logger.debug('Tools validated', { toolCount: this.config.tools?.length });

      // 3. Apply spawn constraint defaults (per FR-003c)
      const spawnConstraints = this.applySpawnConstraintDefaults(this.config.spawnConstraints);
      logger.debug('Spawn constraints applied', spawnConstraints);

      // 4. Create and return agent
      const agent = new Agent(this.config, this.provider, spawnConstraints);
      logger.debug('Agent created successfully', { agentId: agent.state.id });

      return agent;
    } catch (error: any) {
      logger.error('AgentFactory.build() failed', {
        error: error.message,
        code: error.code,
        config: this.config,
      });
      throw error;
    }
  }

  /**
   * Validate tool definitions
   * - Reject duplicate tool names within single agent
   * - Ensure each tool has required fields (name, description, schema, handler)
   */
  private validateTools(tools?: Tool[]): void {
    if (!tools || tools.length === 0) return;

    const seenNames = new Set<string>();

    for (const tool of tools) {
      // Check for required fields
      if (!tool.name || typeof tool.name !== 'string') {
        throw new Error('Tool must have a non-empty name (string)');
      }

      if (!tool.description || typeof tool.description !== 'string') {
        throw new Error(`Tool "${tool.name}" must have a non-empty description (string)`);
      }

      if (!tool.schema || typeof tool.schema !== 'object') {
        throw new Error(`Tool "${tool.name}" must have a schema (JSONSchema object)`);
      }

      if (!tool.handler || typeof tool.handler !== 'function') {
        throw new Error(`Tool "${tool.name}" must have a handler (async function)`);
      }

      // Check for duplicates (per FR-003b)
      if (seenNames.has(tool.name)) {
        throw new Error(`Duplicate tool name within agent: "${tool.name}" (strict isolation required)`);
      }

      seenNames.add(tool.name);
    }
  }

  /**
   * Apply spawn constraint defaults
   * Defaults: maxCount=100, maxDepth=10, allowedTypes=[] (any type)
   */
  private applySpawnConstraintDefaults(constraints?: Partial<SpawnConstraints>): SpawnConstraints {
    const defaults: SpawnConstraints = {
      maxCount: 100,
      maxDepth: 10,
      allowedTypes: [],
    };

    if (!constraints) return defaults;

    const merged = { ...defaults, ...constraints };

    // Validate merged constraints
    validateSpawnConstraints(merged);

    return merged;
  }
}

/**
 * Factory function for convenience
 * Usage: const agent = await createAgent(config, provider);
 */
export async function createAgent(
  config: AgentConfig,
  provider: BaseAIProvider
): Promise<Agent> {
  const factory = new AgentFactory(config, provider);
  return factory.build();
}
