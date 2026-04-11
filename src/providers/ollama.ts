/**
 * Ollama Provider Adapter
 * 
 * Connects to local Ollama instance for LLM inference
 * Supports tool calling via function definitions
 * 
 * Default endpoint: http://localhost:11434
 */

import { BaseAIProvider } from './base';
import { Tool, Message } from '../types';
import { logger } from '../observability/logger';
import { createMessage } from '../core/message';

export interface OllamaConfig {
  baseUrl?: string; // Default: http://localhost:11434
  model: string; // Model name (e.g., 'llama2', 'mistral')
  timeout?: number; // ms, default 30000
}

export class OllamaProvider extends BaseAIProvider {
  readonly name = 'ollama';
  private baseUrl: string;
  private model: string;
  private timeout: number;
  private isAuthenticated = false;

  constructor(config: OllamaConfig) {
    super();
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
    this.model = config.model;
    this.timeout = config.timeout || 30000;

    logger.debug('OllamaProvider initialized', {
      baseUrl: this.baseUrl,
      model: this.model,
    });
  }

  /**
   * Authenticate and validate connectivity to Ollama (fail-fast per FR-001a)
   */
  async authenticate(): Promise<void> {
    try {
      logger.debug('OllamaProvider.authenticate() starting', { baseUrl: this.baseUrl });

      // Check connectivity by pulling model tags
      const response = await this.fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw new Error(`Ollama API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      logger.debug('Ollama connectivity verified', { models: (data.models || []).length });

      // Verify model is available
      const availableModels = (data.models || []).map((m: any) => m.name);
      if (!availableModels.includes(this.model)) {
        const error = new Error(
          `Model "${this.model}" not found in Ollama. Available: ${availableModels.join(', ')}`
        );
        logger.error('Model not found', { model: this.model, available: availableModels });
        throw error;
      }

      this.isAuthenticated = true;
      logger.debug('OllamaProvider authenticated successfully');
    } catch (error: any) {
      const failFastError = new Error(`Ollama provider failed to authenticate: ${error.message}`);
      (failFastError as any).code = 'OLLAMA_AUTH_FAILED';
      logger.error('OllamaProvider authentication failed', { error: error.message });
      throw failFastError;
    }
  }

  /**
   * Translate Tool[] to Ollama-compatible function definitions
   */
  async translateToolsToLLM(tools: Tool[]): Promise<any> {
    // Ollama supports function calling in recent versions
    // Convert to OpenAI-compatible format
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema,
      },
    }));
  }

  /**
   * Call Ollama LLM API with message history and optional tools
   */
  async callLLM(messages: Message[], tools?: Tool[]): Promise<Message> {
    if (!this.isAuthenticated) {
      throw new Error('Provider not authenticated. Call authenticate() first.');
    }

    try {
      logger.debug('OllamaProvider.callLLM() called', {
        messageCount: messages.length,
        toolCount: tools?.length || 0,
        model: this.model,
      });

      // Format messages for Ollama API
      const formattedMessages = messages.map((msg) => ({
        role: msg.role || 'user',
        content: msg.content,
      }));

      const payload: any = {
        model: this.model,
        messages: formattedMessages,
        stream: false,
      };

      // Add tools if available
      if (tools && tools.length > 0) {
        const toolDefinitions = await this.translateToolsToLLM(tools);
        payload.tools = toolDefinitions;
      }

      logger.debug('Sending request to Ollama', { model: this.model, messageCount: messages.length });

      const response = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: this.timeout,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      logger.debug('Ollama response received', { finishReason: result.message?.finishReason });

      // Parse response and handle tool calls if any
      const parsedMessage = await this.parseResponse(result);

      return parsedMessage;
    } catch (error: any) {
      logger.error('OllamaProvider.callLLM() error', { error: error.message });

      const errorResponse = createMessage('error', error.message);
      (errorResponse as any).error = {
        name: error.name,
        message: error.message,
        code: (error as any).code || 'OLLAMA_ERROR',
      };

      return errorResponse;
    }
  }

  /**
   * Parse Ollama response and extract tool calls if any
   */
  async parseResponse(response: any): Promise<Message> {
    try {
      const assistantMessage = response.message;

      if (!assistantMessage) {
        throw new Error('Invalid Ollama response: missing message');
      }

      const message = createMessage(
        'assistant',
        assistantMessage.content || '',
        { finishReason: response.done }
      );

      // Check for tool calls in tool_calls array (if supported)
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        (message as any).toolCalls = assistantMessage.tool_calls.map((call: any) => ({
          id: call.id || `call_${Date.now()}`,
          name: call.function?.name || call.name,
          arguments: typeof call.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments || call.arguments || {}),
        }));
      }

      return message;
    } catch (error: any) {
      logger.error('OllamaProvider.parseResponse() error', { error: error.message });
      const errorMessage = createMessage('error', error.message);
      (errorMessage as any).error = {
        name: error.name,
        message: error.message,
        code: 'OLLAMA_PARSE_ERROR',
      };
      return errorMessage;
    }
  }

  /**
   * Fetch wrapper with timeout handling
   */
  private async fetch(
    url: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<Response> {
    const timeout = options.timeout || this.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await globalThis.fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Factory for creating Ollama provider
 */
export function createOllamaProvider(config: OllamaConfig): OllamaProvider {
  return new OllamaProvider(config);
}

