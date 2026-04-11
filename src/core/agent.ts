/**
 * Agent - Core runtime for message processing and tool execution
 * 
 * Responsibilities:
 * - Receive and process messages
 * - Execute tools with error handling (errors in message payloads, not exceptions)
 * - Route messages to spawned children (via sessions)
 * - Maintain message history and state
 * - Expose .inspect() for observability (Principle V)
 * - Cascading termination on parent death
 */

import {
  Message,
  AgentConfig,
  AgentState,
  Tool,
  SpawnConstraints,
  AIProvider,
} from '../types';
import { createMessage } from './message';
import { nanoid } from 'nanoid';
import { logger } from '../observability/logger';
import { serializeAgent } from '../utils/serialization';

export class Agent {
  readonly state: AgentState;
  private provider: AIProvider;
  private tools: Tool[];
  private spawnConstraints: SpawnConstraints;
  private activeSessions: Map<string, any>; // sessionId -> AgentSession

  constructor(
    config: AgentConfig,
    provider: AIProvider,
    spawnConstraints: SpawnConstraints,
  ) {
    this.state = {
      id: nanoid(),
      status: 'idle',
      messageHistory: [],
      activeChildren: [],
      createdAt: Date.now(),
    };
    this.provider = provider;
    this.tools = config.tools || [];
    this.spawnConstraints = spawnConstraints;
    this.activeSessions = new Map();

    logger.debug('Agent created', {
      agentId: this.state.id,
      toolCount: this.tools.length,
      spawnConstraints,
    });
  }

  /**
   * Receive and process a message (FR-005: explicit protocol)
   * Returns response message with tool execution results or error payload
   */
  async receive(message: Message): Promise<Message> {
    logger.debug('Agent.receive() called', {
      agentId: this.state.id,
      messageId: message.id,
    });

    // Validate message routing
    if (message.recipient !== this.state.id && message.recipient !== '*') {
      const error = new Error(`Message not intended for this agent. Recipient: ${message.recipient}`);
      logger.error('Message routing error', { agentId: this.state.id, messageId: message.id });
      return this.createErrorResponse(message, error);
    }

    this.state.messageHistory.push(message);
    this.state.status = 'running';

    try {
      // Dispatch by message type
      if (message.type === 'request') {
        return await this.handleRequest(message);
      } else if (message.type === 'response') {
        return await this.handleResponse(message);
      } else {
        const error = new Error(`Unknown message type: ${(message as any).type}`);
        return this.createErrorResponse(message, error);
      }
    } catch (error: any) {
      logger.error('Agent.receive() error', {
        agentId: this.state.id,
        error: error.message,
      });
      return this.createErrorResponse(message, error);
    } finally {
      this.state.status = 'idle';
    }
  }

  /**
   * Handle request message - execute tool if requested
   */
  private async handleRequest(message: Message): Promise<Message> {
    const toolName = (message as any).tool;

    if (!toolName) {
      return createMessage(
        'response',
        JSON.stringify({ status: 'ack', messageId: message.id }),
        (message as any).metadata,
      );
    }

    // Find tool in agent's tool list
    const tool = this.tools.find((t) => t.name === toolName);

    if (!tool) {
      const error = new Error(`Tool not found: "${toolName}"`);
      logger.error('Tool not found', { agentId: this.state.id, toolName });
      return this.createErrorResponse(message, error);
    }

    // Execute tool with error handling (errors as payload, per FR-006)
    try {
      const input = (message as any).input || {};
      const result = await tool.handler(input);

      const response = createMessage('response', JSON.stringify(result), {
        ...(message as any).metadata,
        toolName,
        status: 'success',
      });
      this.state.messageHistory.push(response);
      return response;
    } catch (error: any) {
      // Error captured in payload, not thrown (FR-006)
      logger.error('Tool execution error', {
        agentId: this.state.id,
        toolName,
        error: error.message,
      });
      return this.createErrorResponse(message, error, { toolName });
    }
  }

  /**
   * Handle response message - route to child session or process locally
   */
  private async handleResponse(message: Message): Promise<Message> {
    // Check if this is a response to a child agent
    const sessionId = (message as any).sessionId;
    if (sessionId && this.activeSessions.has(sessionId)) {
      // Session will handle routing the response to the child
    }

    return message;
  }

  /**
   * Create error response message
   */
  private createErrorResponse(
    originalMessage: Message,
    error: Error,
    context?: Record<string, any>,
  ): Message {
    const errorPayload = {
      name: error.name,
      message: error.message,
      code: (error as any).code || 'AGENT_ERROR',
      ...(error.stack && { stack: error.stack }),
      ...context,
    };

    const response = createMessage(
      'error',
      JSON.stringify(errorPayload),
      {
        originalMessageId: originalMessage.id,
      } as any
    );

    // Cast to add type field
    (response as any).type = 'error';

    this.state.messageHistory.push(response);
    return response;
  }

  /**
   * Execute tool directly (for testing/internal use)
   */
  async executeTool(toolName: string, input: any): Promise<any> {
    const tool = this.tools.find((t) => t.name === toolName);

    if (!tool) {
      throw new Error(`Tool not found: "${toolName}"`);
    }

    try {
      return await tool.handler(input);
    } catch (error: any) {
      logger.error('Tool execution error', {
        agentId: this.state.id,
        toolName,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Inspect agent state (Principle V: observability)
   * Returns serializable snapshot of internal state
   */
  inspect() {
    return serializeAgent(this);
  }

  /**
   * Terminate agent and cascade terminate children
   * (Cascading termination per FR-010)
   */
  async terminate(): Promise<void> {
    logger.debug('Agent.terminate() called', { agentId: this.state.id });

    this.state.status = 'terminated';

    // Cascade terminate all active children
    for (const sessionId of this.activeSessions.keys()) {
      const session = this.activeSessions.get(sessionId);
      if (session && session.terminate) {
        await session.terminate();
      }
    }

    this.activeSessions.clear();
    this.state.terminatedAt = Date.now();

    logger.debug('Agent terminated', {
      agentId: this.state.id,
      childrenTerminated: this.state.activeChildren.length,
    });
  }

  /**
   * Add a spawned child session
   */
  addChild(sessionId: string, session: any): void {
    this.activeSessions.set(sessionId, session);
    this.state.activeChildren.push(sessionId);
    logger.debug('Child agent added', {
      agentId: this.state.id,
      sessionId,
      totalChildren: this.state.activeChildren.length,
    });
  }

  /**
   * Remove a child session (on termination or cleanup)
   */
  removeChild(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.state.activeChildren = this.state.activeChildren.filter((id) => id !== sessionId);
    logger.debug('Child agent removed', {
      agentId: this.state.id,
      sessionId,
      remainingChildren: this.state.activeChildren.length,
    });
  }

  /**
   * Get current active spawn count for constraint validation
   */
  getActiveSpawnCount(): number {
    return this.state.activeChildren.length;
  }

  /**
   * Get current spawn constraints
   */
  getSpawnConstraints(): SpawnConstraints {
    return this.spawnConstraints;
  }

  /**
   * Get tools available to this agent
   */
  getTools(): Tool[] {
    return this.tools;
  }

  /**
   * Get provider instance
   */
  getProvider(): AIProvider {
    return this.provider;
  }
}
