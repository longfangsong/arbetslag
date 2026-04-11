/**
 * Core types and interfaces for the Agent Factory framework.
 * This file defines the fundamental building blocks of the system.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool' | 'error';

export interface Message {
  id: string;
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: object; // JSON Schema
}

export interface SpawnConstraints {
  maxCount: number;
  maxDepth: number;
  allowedTypes?: string[];
}

export interface AgentConfig {
  provider: string;
  providerConfig: Record<string, unknown>;
  tools?: Tool[];
  spawnConstraints?: SpawnConstraints;
}

export interface AgentState {
  id: string;
  parentId?: string;
  status: 'idle' | 'running' | 'terminated' | 'error';
  messageHistory: Message[];
  activeChildren: string[]; // IDs of child agents
  createdAt: number;
  terminatedAt?: number;
}

export interface AgentEvent {
  type: 'message_received' | 'tool_called' | 'tool_result' | 'child_spawned' | 'child_terminated' | 'error';
  agentId: string;
  payload: unknown;
  timestamp: number;
}

export interface AgentError extends Error {
  code: string;
  agentId?: string;
  context?: Record<string, unknown>;
}

export interface AIProvider {
  name: string;
  authenticate(): Promise<void>;
  translateToolsToLLM(tools: Tool[]): Promise<unknown>;
  callLLM(messages: Message[]): Promise<Message>;
  parseResponse(response: unknown): Promise<Message>;
}
