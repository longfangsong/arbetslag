/**
 * Arbetslag - Agent Factory
 * 
 * Multi-agent orchestration framework for building scalable AI-powered applications.
 * Features dynamic agent spawning, constraint-based composition, and type-safe message passing.
 * 
 * @see https://github.com/arbetslag/agent-factory
 */

// Core exports
export { Agent } from './core/agent';
export { AgentFactory, createAgent } from './core/factory';
export { createMessage } from './core/message';
export { ToolExecutor, ToolValidator } from './core/tool';
export { SpawnConstraintsValidator, validateSpawnConstraints } from './core/spawn-constraints';

// Type exports
export type {
  Message,
  MessageType,
  Role,
  Tool,
  ToolCall,
  ToolResult,
  SpawnConstraints,
  AgentConfig,
  AgentState,
  AgentEvent,
  AgentError,
  AIProvider,
} from './types';

// Provider exports
export { BaseAIProvider } from './providers/base';
export { OllamaProvider, createOllamaProvider } from './providers/ollama';
export type { OllamaConfig } from './providers/ollama';
export { GeminiProvider, createGeminiProvider } from './providers/gemini';
export type { GeminiConfig } from './providers/gemini';

// Observability exports
export { logger, createLogger, Logger } from './observability/logger';
export type { LogLevel, LogContext } from './observability/logger';

// Serialization exports
export { Serializer, serializeAgent, serializeSession } from './utils/serialization';
