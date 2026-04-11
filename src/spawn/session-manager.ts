/**
 * AgentSession - Lifecycle management for spawned agents
 * 
 * Responsibilities:
 * - Track session state (sessionId, parent, depth, spawn count)
 * - Route messages to spawned child agent
 * - Enforce spawn constraints
 * - Handle cascading termination
 * - Provide observability via .inspect()
 */

import { Message, SpawnConstraints } from '../types';
import { Agent } from './agent';
import { nanoid } from 'nanoid';
import { logger } from '../observability/logger';
import { serializeSession } from '../utils/serialization';

export interface AgentSessionConfig {
  agent: Agent;
  parentId?: string;
  currentDepth: number;
}

export class AgentSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly parentId?: string;
  readonly currentDepth: number;
  readonly createdAt: number;
  private agent: Agent;
  private alive = true;
  private terminatedAt?: number;
  private messageHistory: Message[] = [];

  constructor(config: AgentSessionConfig) {
    this.sessionId = nanoid();
    this.agent = config.agent;
    this.agentId = config.agent.state.id;
    this.parentId = config.parentId;
    this.currentDepth = config.currentDepth;
    this.createdAt = Date.now();

    logger.debug('AgentSession created', {
      sessionId: this.sessionId,
      agentId: this.agentId,
      parentId: this.parentId,
      depth: this.currentDepth,
    });
  }

  /**
   * Send a message to the spawned agent and get response
   */
  async send(message: Message): Promise<Message> {
    if (!this.alive) {
      throw new Error(`Session ${this.sessionId} is terminated`);
    }

    logger.debug('AgentSession.send() called', {
      sessionId: this.sessionId,
      messageId: message.id,
    });

    // Route message to child agent
    const response = await this.agent.receive(message);

    // Store in message history
    this.messageHistory.push(message);
    this.messageHistory.push(response);

    return response;
  }

  /**
   * Terminate the session and cascade terminate the child agent
   */
  async terminate(): Promise<void> {
    if (!this.alive) {
      return; // Already terminated
    }

    logger.debug('AgentSession.terminate() called', {
      sessionId: this.sessionId,
      agentId: this.agentId,
    });

    this.alive = false;
    this.terminatedAt = Date.now();

    // Cascade terminate child agent
    await this.agent.terminate();

    logger.debug('AgentSession terminated', {
      sessionId: this.sessionId,
      duration: this.terminatedAt - this.createdAt,
    });
  }

  /**
   * Check if session is still alive
   */
  isAlive(): boolean {
    return this.alive;
  }

  /**
   * Get message history
   */
  getMessageHistory(): Message[] {
    return [...this.messageHistory];
  }

  /**
   * Inspect session state (Principle V: observability)
   */
  inspect() {
    return serializeSession(this);
  }

  /**
   * Validate if a child agent spawn would exceed constraints
   */
  static validateSpawnConstraints(
    parentConstraints: SpawnConstraints,
    currentDepth: number,
    activeSpawnCount: number
  ): void {
    // Check maxDepth
    if (currentDepth >= parentConstraints.maxDepth) {
      const error = new Error(
        `Cannot spawn agent: exceeds maxDepth=${parentConstraints.maxDepth} (current=${currentDepth})`
      );
      (error as any).code = 'SPAWN_DEPTH_EXCEEDED';
      throw error;
    }

    // Check maxCount
    if (activeSpawnCount >= parentConstraints.maxCount) {
      const error = new Error(
        `Cannot spawn agent: exceeds maxCount=${parentConstraints.maxCount} (active=${activeSpawnCount})`
      );
      (error as any).code = 'SPAWN_COUNT_EXCEEDED';
      throw error;
    }
  }
}

/**
 * Factory function for creating sessions
 */
export function createSession(config: AgentSessionConfig): AgentSession {
  return new AgentSession(config);
}
