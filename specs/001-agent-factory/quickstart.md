# Quickstart: Agent Factory

**Date**: 2026-04-10  
**Status**: Phase 1 Complete  
**Target Audience**: Node.js developers with basic TypeScript knowledge

## Installation

```bash
npm install arbetslag
# or
yarn add arbetslag
```

## Prerequisite: Start Local Ollama

Download Ollama: https://ollama.ai

```bash
ollama serve  # Runs on http://localhost:11434
```

In another terminal:

```bash
ollama pull llama2  # Download model (~4GB)
```

## Example 1: Single Agent with Ollama (15 LOC)

Create a simple agent that can search and summarize:

```typescript
import { AgentFactory, Tool } from 'arbetslag';

const tools: Tool[] = [
  {
    name: 'search',
    description: 'Search the internet for information',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query']
    },
    handler: async (input) => {
      // Mock: in real app, call search API
      return { results: [`Result for ${input.query}`] };
    }
  }
];

const agent = await new AgentFactory({
  provider: {
    name: 'ollama',
    modelName: 'llama2',
    baseUrl: 'http://localhost:11434'
  },
  tools
}).build();

// Send a message
const response = await agent.receive({
  id: 'msg-1',
  sender: 'user',
  recipient: agent.id,
  type: 'request',
  payload: { query: 'What is Rust programming?' },
  timestamp: Date.now()
});

console.log(response.payload);  // { answer: "..." }
```

## Example 2: Multi-Agent Chain (US3)

Agent A spawns Agent B, B spawns Agent C. Work flows C → B → A:

```typescript
import { AgentFactory, Tool, Message } from 'arbetslag';

// Define a simple calculator tool for demonstration
const calcTool: Tool = {
  name: 'calculate',
  description: 'Perform basic math',
  schema: {
    type: 'object',
    properties: {
      expression: { type: 'string' }
    },
    required: ['expression']
  },
  handler: async (input) => {
    try {
      return { result: eval(input.expression) };
    } catch (e) {
      return { error: String(e) };
    }
  }
};

// Create Agent A (can spawn children)
const agentA = await new AgentFactory({
  provider: { name: 'ollama', modelName: 'llama2' },
  tools: [calcTool],
  spawnConstraints: {
    maxCount: 10,
    maxDepth: 3,
    allowedTypes: [] // Any type allowed
  }
}).build();

// Message to A requesting it spawn B
const spawnMessage: Message = {
  id: 'spawn-1',
  sender: 'user',
  recipient: agentA.id,
  type: 'request',
  payload: {
    action: 'spawn_agent',
    config: {
      provider: { name: 'ollama', modelName: 'llama2' },
      tools: [calcTool],
      spawnConstraints: {
        maxCount: 5,
        maxDepth: 2
      }
    }
  },
  timestamp: Date.now()
};

const spawnResult = await agentA.receive(spawnMessage);
console.log(spawnResult.payload);  // { sessionId: "...", agentId: "..." }

// Retrieve child agent and send it a message
const childSessionId = spawnResult.payload.sessionId;
// (In real app, parent routes messages to child via session manager)
```

## Example 3: Using Google Gemini (Cloud Testing)

```typescript
import { AgentFactory } from 'arbetslag';

const agent = await new AgentFactory({
  provider: {
    name: 'gemini',
    modelName: 'gemini-pro',
    apiKey: process.env.GEMINI_API_KEY
  },
  tools: [
    {
      name: 'get_time',
      description: 'Get current time',
      schema: {
        type: 'object',
        properties: {},
        required: []
      },
      handler: async () => ({ time: new Date().toISOString() })
    }
  ]
}).build();

const msg = await agent.receive({
  id: 'msg-2',
  sender: 'user',
  recipient: agent.id,
  type: 'request',
  payload: { question: 'What time is it?' },
  timestamp: Date.now()
});

console.log(msg.payload);
```

## Example 4: Inspect Agent State (Principle V Observability)

```typescript
const state = await agent.inspect();
console.log(JSON.stringify(state, null, 2));
// {
//   "id": "agent-abc123",
//   "provider": { "name": "ollama", "modelName": "llama2" },
//   "tools": [
//     { "name": "search", "description": "Search..." }
//   ],
//   "spawnConstraints": {
//     "maxCount": 100,
//     "maxDepth": 10,
//     "allowedTypes": []
//   },
//   "activeChildren": [],
//   "messageHistorySummary": {
//     "total": 1,
//     "recent": [...]
//   }
// }
```

## Example 5: Error Handling

Tool errors are surfaced as message payloads (not thrown exceptions):

```typescript
const errorTool: Tool = {
  name: 'failingTool',
  description: 'A tool that always fails',
  schema: { type: 'object', properties: {}, required: [] },
  handler: async () => {
    throw new Error('Tool failed!');
  }
};

const agent = await new AgentFactory({
  provider: { name: 'ollama', modelName: 'llama2' },
  tools: [errorTool]
}).build();

const response = await agent.receive({
  id: 'msg-3',
  sender: 'user',
  recipient: agent.id,
  type: 'request',
  payload: { action: 'execute_tool', tool: 'failingTool' },
  timestamp: Date.now()
});

console.log(response.type);  // 'error'
console.log(response.error); // { name: 'ToolExecutionError', message: '...', code: 'TOOL_FAILED' }
```

## Example 6: Spawn Constraints Enforcement

```typescript
const agent = await new AgentFactory({
  provider: { name: 'ollama', modelName: 'llama2' },
  tools: [],
  spawnConstraints: {
    maxCount: 2,     // Can only spawn 2 children
    maxDepth: 1,     // Children cannot spawn further
    allowedTypes: [] // Any type allowed
  }
}).build();

// First spawn: OK
// Second spawn: OK
// Third spawn: Framework rejects with error in message
```

## Pattern: Fan-Out (1 Agent → Multiple Children)

```typescript
// Parent spawns 3 workers in parallel
const childConfigs = [
  { provider: { name: 'ollama', modelName: 'llama2' }, tools: [...] },
  { provider: { name: 'ollama', modelName: 'llama2' }, tools: [...] },
  { provider: { name: 'ollama', modelName: 'llama2' }, tools: [...] }
];

const spawnPromises = childConfigs.map(config =>
  agent.receive({
    id: `spawn-${Math.random()}`,
    sender: 'user',
    recipient: agent.id,
    type: 'request',
    payload: { action: 'spawn_agent', config },
    timestamp: Date.now()
  })
);

const results = await Promise.all(spawnPromises);
console.log(results);  // [{ sessionId: "..." }, { sessionId: "..." }, { sessionId: "..." }]
```

## Edge Runtime Compatibility

Arbetslag exports are tree-shaking compatible via tsup + esbuild:

```typescript
// Works in Cloudflare Workers
import { createAgent } from 'arbetslag';  // Only includes needed code

// Providers are optional imports (avoid bundling unused SDKs)
import { OllamaProvider } from 'arbetslag/providers/ollama';
import { GeminiProvider } from 'arbetslag/providers/gemini';
```

## TypeScript Support

Full TypeScript support (strict mode):

```typescript
import { Agent, Message, Tool, AgentFactory, SpawnConstraints } from 'arbetslag';

const config: AgentConfig = {
  provider: {
    name: 'ollama',
    modelName: 'llama2'
  },
  tools: toolsArray as Tool[]
};

const factory = new AgentFactory(config);
const agent: Agent = await factory.build();
const response: Message = await agent.receive(inputMessage);
```

---

**Next Steps**:
- Explore [data-model.md](./data-model.md) for entity details
- Review [contracts/](./contracts/) for JSON schema definitions
- Check [spec.md](./spec.md) for full requirements

**Status**: ✅ **Ready for Implementation (Phase 2: Tasks)**
