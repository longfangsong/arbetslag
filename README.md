# Arbetslag: Agent Factory

Multi-agent orchestration framework for building scalable AI-powered applications. Features dynamic agent spawning, constraint-based composition, and type-safe message passing.

**Status**: MVP - Phase 1-2 Complete (v1.0.0)

## Features

- 🤖 **Agent Factory**: Create agents with AI providers and custom tools
- 🌱 **Dynamic Spawning**: Agents can spawn child agents with configurable constraints
- 🔗 **Multi-Agent Composition**: Chain and fan-out patterns for complex workflows
- 📮 **Protocol-Based Communication**: Type-safe message passing with contracts
- 🔍 **Observability**: JSON logging and `.inspect()` serialization for debugging
- 🎯 **Edge Runtime Ready**: ESM distribution targets Cloudflare Workers

## Installation

```bash
pnpm add arbetslag
# or
npm install arbetslag
# or
yarn add arbetslag
```

## Quick Start

### 1. Prerequisites

**Ollama** (for local LLM):
```bash
# Download from https://ollama.ai
ollama serve  # Runs on http://localhost:11434
ollama pull llama2
```

### 2. Basic Agent (Under 50 LOC)

```typescript
import { AgentFactory } from 'arbetslag';

const agent = await new AgentFactory({
  provider: {
    name: 'ollama',
    modelName: 'llama2',
    baseUrl: 'http://localhost:11434'
  },
  tools: [
    {
      name: 'calculate',
      description: 'Perform basic math operations',
      schema: {
        type: 'object',
        properties: {
          expression: { type: 'string' }
        },
        required: ['expression']
      },
      handler: async (input: any) => ({
        result: eval(input.expression)  // In production: use math.js
      })
    }
  ]
}).build();

// Send a message
const response = await agent.receive({
  id: 'msg-1',
  sender: 'user',
  recipient: agent.id,
  type: 'request',
  payload: { query: 'What is 2 + 2?' },
  timestamp: Date.now()
});

console.log(response.payload);
```

### 3. Gemini Provider

```typescript
const agent = await new AgentFactory({
  provider: {
    name: 'gemini',
    apiKey: process.env.GEMINI_API_KEY,
    modelName: 'gemini-1.5-flash'
  },
  tools: [
    // ... your tools
  ]
}).build();
```

## Multi-Agent Spawning

Parent agent spawns child agents with spawn constraints:

```typescript
import { AgentFactory, SpawnConstraints } from 'arbetslag';

const constraints: SpawnConstraints = {
  maxCount: 5,           // Max 5 children
  maxDepth: 3,           // Max 3 levels deep
  allowedTypes: ['task']
};

const parentAgent = await new AgentFactory({
  provider: { /* ... */ },
  tools: [ /* ... */ ],
  spawnConstraints: constraints
}).build();

// Agent can use built-in spawn_agent tool to create children
const spawnResult = await parentAgent.receive({
  type: 'request',
  sender: 'user',
  recipient: parentAgent.id,
  payload: {
    toolName: 'spawn_agent',
    args: {
      config: {
        provider: { name: 'ollama', modelName: 'llama2' },
        tools: [ /* child tools */ ]
      }
    }
  }
});
```

## Architecture

### Core Concepts

- **Agent**: Receives messages, routes to tools, executes, returns response
- **Message**: Protocol-defined payloads with sender/recipient/type
- **Tool**: Named function with schema registered on agent
- **AIProvider**: Adapter for LLM backends (Ollama, Gemini, custom)
- **SpawnConstraints**: Rules limiting agent spawning depth/count
- **AgentSession**: Manages agent lifecycle and parent-child relationships

### Message Flow

```
User → Message → Agent.receive()
                    ↓
              Tool Selection
                    ↓
              Tool Execution
                    ↓
              Error Handling
                    ↓
              Response Message ← User
```

### Project Structure

```
src/
├── core/           # Core types & Agent runtime
├── providers/      # AI provider adapters
├── spawn/          # Spawning & session management
├── observability/  # JSON logging & tracing
└── utils/          # Serialization & helpers

tests/
├── unit/           # Component tests
├── contract/       # Schema validation tests
└── integration/    # Multi-agent workflow tests
```

## API Reference

### AgentFactory

```typescript
const factory = new AgentFactory({
  provider: { name: 'ollama', modelName: 'llama2', ... },
  tools: [ tool1, tool2 ],
  spawnConstraints: { maxCount: 5, maxDepth: 3 }
});

const agent = await factory.build();
```

### Agent

```typescript
// Receive message & execute
const response = await agent.receive(message);

// Get agent state snapshot
const state = agent.inspect();

// Access metadata
console.log(agent.id, agent.provider, agent.tools);
```

### Message

```typescript
interface Message {
  id: string;                    // Unique ID
  sender: string;                // Agent/user ID
  recipient: string;             // Target agent ID
  type: 'request' | 'response' | 'error';
  payload: Record<string, any>;  // Tool args or result
  timestamp: number;             // Unix timestamp
  context?: Record<string, any>; // Trace IDs, correlation IDs
}
```

### Tool

```typescript
interface Tool {
  name: string;
  description: string;
  schema: JSONSchema;
  handler: (input: Record<string, any>) => Promise<any>;
}
```

## Providers

### Ollama (Local LLM)

```typescript
{
  name: 'ollama',
  baseUrl: 'http://localhost:11434',  // Default
  modelName: 'llama2',                // Required
  timeout?: 30000
}
```

**Setup**:
```bash
ollama serve
ollama pull llama2
```

### Gemini (Google AI Studio)

```typescript
{
  name: 'gemini',
  apiKey: process.env.GEMINI_API_KEY,  // Required
  modelName: 'gemini-1.5-flash'        // Default
}
```

**Setup**:
1. Get API key from [Google AI Studio](https://aistudio.google.com)
2. Export: `export GEMINI_API_KEY=your_key`

## Development

### Scripts

```bash
pnpm build          # Build ESM + CJS
pnpm dev            # Watch mode
pnpm test           # Run tests
pnpm test:ui        # Vitest UI dashboard
pnpm test:coverage  # Coverage report
pnpm lint           # Lint + fix
pnpm format         # Format code
pnpm type-check     # TypeScript check
```

### Testing

Tests are organized by phase:

- **Unit Tests** (`tests/unit/`): Component isolation
- **Contract Tests** (`tests/contract/`): Message & tool schema validation
- **Integration Tests** (`tests/integration/`): Multi-agent workflows

Coverage threshold: **95%**

```bash
pnpm test:coverage
```

## Principles

1. **Agent-First Design**: Agents are primary primitives; spawning is core
2. **Protocol-Based Communication**: All messages conform to contracts
3. **Type Safety**: Strict TypeScript + JSONSchema validation
4. **Observable**: Structured logging + `.inspect()` snapshots
5. **Test-Driven**: Acceptance scenarios define contracts

## Roadmap

### Phase 1 ✅ (Complete)
- Core agent runtime + message passing
- AgentFactory with validation
- Ollama + Gemini providers
- Unit tests & CI/CD

### Phase 2 ✅ (Complete)
- Dynamic agent spawning
- Spawn constraints (maxCount, maxDepth)
- Parent-child session management
- Integration tests

### Phase 3 (Planned)
- Multi-agent composition helpers
- Message ordering guarantees
- Error propagation in chains
- Acceptance scenario tests

### Phase 4+ (Future)
- Advanced provider adapters
- Custom middleware/interceptors
- Prometheus metrics
- OpenTelemetry integration
- Edge runtime optimizations

## Examples

### Fan-Out Pattern

One agent spawns multiple children and collects results:

```typescript
// See: docs/patterns/fan-out.md
```

### Error Handling

Errors propagate from child to parent with context:

```typescript
// See: docs/patterns/error-propagation.md
```

### Message Tracing

Trace messages across multi-agent chains:

```typescript
const response = await agent.receive({
  ...message,
  context: {
    traceId: 'trace-abc123',
    correlationId: 'corr-xyz789'
  }
});

const state = agent.inspect();  // Includes trace context
```

## Troubleshooting

### Ollama Connection Failed

```
Error: connect ECONNREFUSED 127.0.0.1:11434
```

**Solution**: Ensure Ollama is running
```bash
ollama serve
```

### Model Not Found

```
Error: model 'llama2' not found
```

**Solution**: Pull the model
```bash
ollama pull llama2
```

### Tool Execution Timeout

Increase timeout in provider config:

```typescript
{
  name: 'ollama',
  baseUrl: 'http://localhost:11434',
  timeout: 60000  // 60 seconds
}
```

## Contributing

1. Create feature branch: `git checkout -b feature/your-feature`
2. Write tests first
3. Implement feature
4. Ensure tests pass: `pnpm test`
5. Lint & format: `pnpm lint && pnpm format`
6. Submit PR

## License

MIT

## References

- [Architecture Decision Records](docs/adr/)
- [Provider Guide](docs/providers/)
- [API Documentation](docs/api/)
- [Composition Patterns](docs/patterns/)

---

**Made with ❤️ for the agent-first future**
