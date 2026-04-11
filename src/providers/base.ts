import { AIProvider, AgentConfig, AgentEvent, AgentState } from '../types';

export interface AIProviderAdapter {
  name: string;
  authenticate(): Promise<void>;
  translateToolsToLLM(tools: any[]): Promise<unknown>;
  callLLM(messages: any[]): Promise<any>;
  parseResponse(response: unknown): Promise<any>;
}

export abstract class BaseAIProvider implements AIProviderAdapter {
  abstract readonly name: string;

  abstract authenticate(): Promise<void>;
  abstract translateToolsToLLM(tools: any[]): Promise<unknown>;
  abstract callLLM(messages: any[]): Promise<any>;
  abstract parseResponse(response: unknown): Promise<any>;

  // Common utility for all providers
  protected async validateConfig(config: AgentConfig): Promise<void> {
    if (!config.provider) {
      throw new Error('Provider must be specified in AgentConfig');
    }
  }
}
