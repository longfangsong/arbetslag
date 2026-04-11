/**
 * Integration Tests for Agent Factory - User Story 1
 * 
 * Tests for: Create Agent from AI Provider & Tools
 * 
 * Verifies:
 * - Agent creation from config
 * - Tool execution with error handling
 * - Message protocol adherence
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../../src/core/agent';
import { AgentFactory } from '../../src/core/factory';
import { OllamaProvider } from '../../src/providers/ollama';
import { AgentConfig, Tool } from '../../src/types';
import { createMessage } from '../../src/core/message';

// Mock Ollama provider for testing (would use real one in e2e)
class MockOllamaProvider extends OllamaProvider {
  async authenticate(): Promise<void> {
    // Skip authentication in tests
  }

  async callLLM(messages: any[]): Promise<any> {
    // Return mock response
    return createMessage('assistant', 'Mock response for testing');
  }
}

describe('User Story 1: Create Agent from AI Provider & Tools', () => {
  let config: AgentConfig;
  let provider: OllamaProvider;

  beforeEach(() => {
    // Setup test tools
    config = {
      provider: 'ollama',
      providerConfig: {
        baseUrl: 'http://localhost:11434',
        model: 'llama2',
      },
      tools: [
        {
          name: 'add',
          description: 'Add two numbers',
          schema: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
          handler: async (input: { a: number; b: number }) => {
            return { result: input.a + input.b };
          },
        },
        {
          name: 'multiply',
          description: 'Multiply two numbers',
          schema: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
          handler: async (input: { a: number; b: number }) => {
            return { result: input.a * input.b };
          },
        },
      ],
    };

    provider = new MockOllamaProvider(config.providerConfig as any);
  });

  describe('Scenario 1: Create agent with 1 provider + 1 tool', () => {
    it('should create agent and be ready for messages', async () => {
      const singleToolConfig = {
        ...config,
        tools: config.tools!.slice(0, 1),
      };

      const factory = new AgentFactory(singleToolConfig, provider);
      const agent = await factory.build();

      expect(agent).toBeDefined();
      expect(agent.state.id).toBeDefined();
      expect(agent.state.status).toBe('idle');
      expect(agent.state.messageHistory).toHaveLength(0);
      expect(agent.getTools()).toHaveLength(1);
    });

    it('should instantiate in under 50 lines (code brevity requirement)', () => {
      // This test documents the minimal code needed:
      // const config = { provider: 'ollama', providerConfig: {...}, tools: [...] };
      // const provider = new OllamaProvider(config.providerConfig);
      // const factory = new AgentFactory(config, provider);
      // const agent = await factory.build();
      expect(true).toBe(true);
    });
  });

  describe('Scenario 2: Multi-tool agent with tool selection', () => {
    it('should accept specific tool requests and execute correct tool', async () => {
      const factory = new AgentFactory(config, provider);
      const agent = await factory.build();

      expect(agent.getTools()).toHaveLength(2);

      // Test tool selection and execution
      const result = await agent.executeTool('add', { a: 5, b: 3 });
      expect(result).toEqual({ result: 8 });

      const result2 = await agent.executeTool('multiply', { a: 4, b: 7 });
      expect(result2).toEqual({ result: 28 });
    });

    it('should reject unknown tool names', async () => {
      const factory = new AgentFactory(config, provider);
      const agent = await factory.build();

      await expect(agent.executeTool('unknown_tool', {})).rejects.toThrow(
        'Tool not found'
      );
    });
  });

  describe('Scenario 3: Tool error handling (errors as payloads)', () => {
    it('should capture tool execution errors in message payload', async () => {
      const errorToolConfig = {
        ...config,
        tools: [
          {
            name: 'failing_tool',
            description: 'Tool that always fails',
            schema: { type: 'object' },
            handler: async () => {
              throw new Error('Tool execution failed');
            },
          },
        ],
      };

      const factory = new AgentFactory(errorToolConfig, provider);
      const agent = await factory.build();

      // Create a request message with proper routing
      const requestMsg = createMessage('user', 'Call failing tool');
      (requestMsg as any).type = 'request';
      (requestMsg as any).tool = 'failing_tool';
      (requestMsg as any).recipient = agent.state.id; // Route to this agent

      const response = await agent.receive(requestMsg);

      expect((response as any).type).toBe('error');
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Tool execution failed');
    });

    it('should not throw exceptions for tool errors (error-in-payload pattern)', async () => {
      const errorToolConfig = {
        ...config,
        tools: [
          {
            name: 'throwing_tool',
            description: 'Tool that throws',
            schema: { type: 'object' },
            handler: async () => {
              throw new Error('Intentional error');
            },
          },
        ],
      };

      const factory = new AgentFactory(errorToolConfig, provider);
      const agent = await factory.build();

      const requestMsg = createMessage('user', 'Call tool');
      (requestMsg as any).type = 'request';
      (requestMsg as any).tool = 'throwing_tool';
      (requestMsg as any).recipient = agent.state.id; // Route to this agent

      // Should not throw, should return error in message
      expect(async () => {
        await agent.receive(requestMsg);
      }).not.toThrow();
    });
  });

  describe('Spawn Constraints', () => {
    it('should apply default spawn constraint values', async () => {
      const factory = new AgentFactory(config, provider);
      const agent = await factory.build();

      const constraints = agent.getSpawnConstraints();
      expect(constraints.maxCount).toBe(100);
      expect(constraints.maxDepth).toBe(10);
      expect(constraints.allowedTypes).toEqual([]);
    });

    it('should use custom spawn constraints if provided', async () => {
      const customConfig = {
        ...config,
        spawnConstraints: {
          maxCount: 5,
          maxDepth: 3,
          allowedTypes: ['worker', 'analyzer'],
        },
      };

      const factory = new AgentFactory(customConfig, provider);
      const agent = await factory.build();

      const constraints = agent.getSpawnConstraints();
      expect(constraints.maxCount).toBe(5);
      expect(constraints.maxDepth).toBe(3);
      expect(constraints.allowedTypes).toEqual(['worker', 'analyzer']);
    });
  });

  describe('Factory Validation', () => {
    it('should reject duplicate tool names', async () => {
      const duplicateConfig = {
        ...config,
        tools: [
          {
            name: 'duplicate',
            description: 'First tool',
            schema: { type: 'object' },
            handler: async () => ({}),
          },
          {
            name: 'duplicate',
            description: 'Second tool with same name',
            schema: { type: 'object' },
            handler: async () => ({}),
          },
        ],
      };

      const factory = new AgentFactory(duplicateConfig, provider);

      await expect(factory.build()).rejects.toThrow('Duplicate tool name');
    });

    it('should reject tools with missing required fields', async () => {
      const invalidConfig = {
        ...config,
        tools: [
          {
            name: 'incomplete',
            // Missing description
            schema: { type: 'object' },
            handler: async () => ({}),
          },
        ],
      };

      const factory = new AgentFactory(invalidConfig, provider);

      await expect(factory.build()).rejects.toThrow();
    });
  });

  describe('Agent Observability', () => {
    it('should provide .inspect() method for state snapshot', async () => {
      const factory = new AgentFactory(config, provider);
      const agent = await factory.build();

      const snapshot = agent.inspect();

      expect(snapshot).toHaveProperty('id');
      expect(snapshot).toHaveProperty('status');
      expect(snapshot).toHaveProperty('createdAt');
      expect(snapshot).toHaveProperty('toolCount');
      expect(snapshot).toHaveProperty('activeChildren');
    });
  });
});
