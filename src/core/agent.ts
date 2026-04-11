import {
  Message,
  Role,
  AgentConfig,
  AgentState,
  AgentEvent,
  AIProvider
} from '../types';
import { createMessage } from '../core/message';
import { ToolExecutor } from '../core/tool';
import { nanoid } from 'nanoid';

export class Agent {
  private state: AgentState;
  private provider: AIProvider;
  private toolExecutor: ToolExecutor;

  constructor(id: string, config: AgentConfig, provider: AIProvider) {
    this.state = {
      id,
      status: 'idle',
      messageHistory: [],
      activeChildren: [],
      createdAt: Date.now(),
    };
    this.provider = provider;
    // In a real implementation, the executor would be initialized with the provider's tools
    this.toolExecutor = new ToolExecutor(new Map());
  }

  /**
   * Receives a message and processes it.
   * This is the primary entry point for interacting with the agent.
   */
  async receiveMessage(role: Role, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const message = createMessage(role, content, metadata);
    this.state.messageHistory.push(message);
    this.state.status = 'running';

    try {
      // 1. Process the message through the LLM
      const response = await this.provider.callLLM(this.state.messageHistory);
      this.state.messageHistory.push(response);

      // 2. Handle potential tool calls in the response
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          const result = await this.toolExecutor.execute(toolCall);
          const toolResultMessage = createMessage('tool', result.content, {
            toolCallId: toolCall.id,
            error: result.error
          });
          this.state.messageHistory.push(toolResultMessage);
        }
        // After tool results, the agent might need another turn
        const followUpResponse = await this.provider.callLLM(this.state.messageHistory);
        this.state.messageHistory.push(followUpResponse);
      }
    } catch (error: any) {
      this.state.status = 'error';
      this.state.messageHistory.push(createMessage('error', error.message));
    } finally {
      if (this.state.status !== 'error') {
        this.state.status = 'idle';
      }
    }
  }

  /**
   * Returns a snapshot of the agent's current state for inspection.
   * Implements the requirement for Principle V (Observability).
   */
  inspect(): AgentState {
    return JSON.parse(JSON.stringify(this.state));
  }

  get id(): string {
    return this.state.id;
  }

  get status(): AgentState['status'] {
    return this.param('status'); // This is a placeholder for actual state access
  }

  private param(key: keyof AgentState): any {
    return this.state[key];
  }
}
