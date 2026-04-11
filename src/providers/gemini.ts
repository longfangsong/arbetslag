/**
 * Gemini Provider Adapter
 * 
 * Connects to Google Gemini API for LLM inference
 * Supports function calling via function_declarations
 * 
 * Constraint: Cannot mix provider-built tools with user-defined tools
 * (per spec assumption on Gemini pre-3.0 limitations)
 */

import { BaseAIProvider } from './base';
import { Tool, Message } from '../types';
import { logger } from '../observability/logger';
import { createMessage } from '../core/message';

export interface GeminiConfig {
  apiKey: string; // Google Gemini API key
  model?: string; // Default: 'gemini-pro'
  timeout?: number; // ms, default 30000
}

export class GeminiProvider extends BaseAIProvider {
  readonly name = 'gemini';
  private apiKey: string;
  private model: string;
  private timeout: number;
  private isAuthenticated = false;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(config: GeminiConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-pro';
    this.timeout = config.timeout || 30000;

    logger.debug('GeminiProvider initialized', {
      model: this.model,
      hasApiKey: !!this.apiKey,
    });
  }

  /**
   * Authenticate and validate API key (fail-fast per FR-001a)
   */
  async authenticate(): Promise<void> {
    try {
      if (!this.apiKey) {
        throw new Error('Gemini API key is required');
      }

      logger.debug('GeminiProvider.authenticate() starting', { model: this.model });

      // Validate API key by making a simple request
      const response = await this.fetch(`${this.baseUrl}/${this.model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello' }] }],
        }),
        timeout: this.timeout,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid or expired Gemini API key');
        }
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      this.isAuthenticated = true;
      logger.debug('GeminiProvider authenticated successfully');
    } catch (error: any) {
      const failFastError = new Error(`Gemini provider failed to authenticate: ${error.message}`);
      (failFastError as any).code = 'GEMINI_AUTH_FAILED';
      logger.error('GeminiProvider authentication failed', { error: error.message });
      throw failFastError;
    }
  }

  /**
   * Translate Tool[] to Gemini-compatible function_declarations format
   * Note: Gemini has constraints on mixing provider tools + user tools
   */
  async translateToolsToLLM(tools: Tool[]): Promise<any> {
    return {
      tools: [
        {
          function_declarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'OBJECT',
              properties: tool.schema.properties || {},
              required: tool.schema.required || [],
            },
          })),
        },
      ],
    };
  }

  /**
   * Call Gemini LLM API with message history and optional tools
   */
  async callLLM(messages: Message[], tools?: Tool[]): Promise<Message> {
    if (!this.isAuthenticated) {
      throw new Error('Provider not authenticated. Call authenticate() first.');
    }

    try {
      logger.debug('GeminiProvider.callLLM() called', {
        messageCount: messages.length,
        toolCount: tools?.length || 0,
        model: this.model,
      });

      // Convert messages to Gemini format
      const contents = messages.map((msg) => ({
        role: this.mapRoleToGemini(msg.role || 'user'),
        parts: [{ text: msg.content }],
      }));

      const payload: any = {
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      };

      // Add tools if available
      if (tools && tools.length > 0) {
        try {
          payload.tools = await this.translateToolsToLLM(tools);
        } catch (error) {
          logger.warn('Failed to translate tools for Gemini', { error });
          // Continue without tools
        }
      }

      logger.debug('Sending request to Gemini', { model: this.model, messageCount: messages.length });

      const response = await this.fetch(
        `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: this.timeout,
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      logger.debug('Gemini response received');

      // Parse response and handle tool calls if any
      const parsedMessage = await this.parseResponse(result);

      return parsedMessage;
    } catch (error: any) {
      logger.error('GeminiProvider.callLLM() error', { error: error.message });

      const errorResponse = createMessage('error', error.message);
      (errorResponse as any).error = {
        name: error.name,
        message: error.message,
        code: (error as any).code || 'GEMINI_ERROR',
      };

      return errorResponse;
    }
  }

  /**
   * Parse Gemini response and extract tool calls if any
   */
  async parseResponse(response: any): Promise<Message> {
    try {
      const candidates = response.candidates || [];
      if (candidates.length === 0) {
        throw new Error('No response candidates from Gemini');
      }

      const candidate = candidates[0];
      const content = candidate.content || {};
      const parts = content.parts || [];

      let textContent = '';
      const toolCalls: any[] = [];

      for (const part of parts) {
        if (part.text) {
          textContent += part.text;
        } else if (part.functionCall) {
          // Handle function calls
          toolCalls.push({
            id: `call_${Date.now()}`,
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          });
        }
      }

      const message = createMessage('assistant', textContent || 'OK');
      (message as any).toolCalls = toolCalls.length > 0 ? toolCalls : undefined;

      return message;
    } catch (error: any) {
      logger.error('GeminiProvider.parseResponse() error', { error: error.message });
      const errorMessage = createMessage('error', error.message);
      (errorMessage as any).error = {
        name: error.name,
        message: error.message,
        code: 'GEMINI_PARSE_ERROR',
      };
      return errorMessage;
    }
  }

  /**
   * Map internal role to Gemini role
   */
  private mapRoleToGemini(role: string): string {
    if (role === 'assistant') return 'model';
    if (role === 'user') return 'user';
    if (role === 'system') return 'user'; // Gemini doesn't have system role
    if (role === 'tool') return 'user';
    return 'user';
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
 * Factory for creating Gemini provider
 */
export function createGeminiProvider(config: GeminiConfig): GeminiProvider {
  return new GeminiProvider(config);
}

