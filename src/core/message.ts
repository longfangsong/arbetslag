import { Message, Role, ToolCall, ToolResult } from '../types';
import { nanoid } from 'nanoid';

export interface MessageFactory {
  createMessage(role: Role, content: string, metadata?: Record<string, unknown>): Message;
}

export class MessageFactoryImpl implements Message
{
  createMessage(role: Role, content: string, metadata: Record<string, unknown> = {}): Message {
    return {
      id: nanoid(),
      role,
      content,
      timestamp: Date.now(),
      metadata,
    };
  }
}

export function createMessage(role: Role, content: string, metadata?: Record<string, unknown>): Message {
  const factory = new MessageFactoryImpl();
  return factory.createMessage(role, content, metadata);
}
