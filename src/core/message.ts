import { Message } from '../types';
import { nanoid } from 'nanoid';

export interface MessageFactory {
  createMessage(role: string, content: string, metadata?: Record<string, unknown>): Message;
}

export class MessageFactoryImpl implements MessageFactory {
  createMessage(role: string, content: string, metadata: Record<string, unknown> = {}): Message {
    return {
      id: nanoid(),
      role: role as any,
      content,
      timestamp: Date.now(),
      metadata,
    };
  }
}

export function createMessage(role: string, content: string, metadata?: Record<string, unknown>): Message {
  const factory = new MessageFactoryImpl();
  return factory.createMessage(role, content, metadata);
}
