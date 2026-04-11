# Data Model: Agent Factory

**Date**: 2026-04-10  
**Status**: Phase 1 Complete  
**Input**: Agent Factory spec + research.md

## Core Entities

### Agent

**Purpose**: Runtime entity that receives messages, selects + executes tools, sends responses.

**State**:
- `id: string` — Unique agent identifier (UUID v4)
- `provider: AIProvider` — LLM provider adapter
- `tools: Tool[]` — Available tools (strict isolation)
- `spawnConstraints: SpawnConstraints` — Limits on child creation
- `messageHistory: Message[]` — Recent message log (optional; for context)
- `activeChildren: Map<string, AgentSession>` — Active spawned child agents
- `isRunning: boolean` — Lifecycle flag

**Methods**:
- `receive(message: Message): Promise<Message>` — Process inbound message
- `send(recipient: string, payload: any, type: 'request'|'response'|'error'): Promise<Message>` — Send message
- `inspect(): Promise<AgentState>` — Return serializable snapshot (Principle V)
- `shutdown(): Promise<void>` — Cascade terminate all children
- `addChild(session: AgentSession): void` — Register spawned child
- `removeChild(sessionId: string): void` — Unregister (on child termination)

**TypeScript Definition**:

```typescript
interface Agent {
  id: string;
  provider: AIProvider;
  tools: Tool[];
  spawnConstraints: SpawnConstraints;
  messageHistory: Message[];
  activeChildren: Map<string, AgentSession>;
  isRunning: boolean;
  
  receive(message: Message): Promise<Message>;
  send(recipient: string, payload: any, type: MessageType): Promise<Message>;
  inspect(): Promise<AgentState>;
  shutdown(): Promise<void>;
  addChild(session: AgentSession): void;
  removeChild(sessionId: string): void;
}
```

### Message

**Purpose**: Request/response envelope for inter-agent communication (Principle II: Protocol-Based).

**Fields**:
- `id: string` — Unique message ID (UUID v4)
- `sender: string` — Sender agent ID
- `recipient: string` — Recipient agent ID (or broadcast ID)
- `type: 'request' | 'response' | 'error'` — Message category
- `payload: any` — Message content (tool request, response, or error)
- `timestamp: number` — Unix milliseconds
- `context?: object` — Optional agent-specific metadata (tracing, correlation IDs, etc. per Principle V)
- `error?: ErrorPayload` — Error struct (if type='error')

**TypeScript Definition**:

```typescript
interface Message {
  id: string;
  sender: string;
  recipient: string;
  type: 'request' | 'response' | 'error';
  payload: any;
  timestamp: number;
  context?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

type MessageType = Message['type'];
```

### Tool

**Purpose**: Callable function with explicit schema for LLM prompt generation + runtime validation (Principle IV: Type Safety).

**Fields** (developer-facing definition):
- `name: string` — Tool identifier (must be unique within agent)
- `description: string` — Human-readable purpose (for LLM)
- `schema: JSONSchema` — Input validation schema (JSON Schema Draft 7)
- `handler: (input: any) => Promise<any>` — Async handler function

**Special Tool**: `spawn_agent` (built-in)
- Creates child agents dynamically
- Properties: name='spawn_agent', schema includes child config + constraints

**TypeScript Definition**:

```typescript
interface Tool {
  name: string;
  description: string;
  schema: JSONSchema; // From json-schema-to-typescript or zod
  handler: (input: any) => Promise<any>;
}

// Special built-in tool signature (not user-definable)
interface SpawnAgentTool extends Tool {
  name: 'spawn_agent';
  handler: (input: SpawnAgentInput) => Promise<SpawnAgentOutput>;
}

interface SpawnAgentInput {
  config: AgentConfig;
  constraints?: Partial<SpawnConstraints>;
  initialMessage?: Message;
}

interface SpawnAgentOutput {
  sessionId: string;
  agentId: string;
  status: 'created' | 'error';
  error?: ErrorPayload;
}
```

### AIProvider

**Purpose**: Adapter translating agent tool requests to LLM calls + response parsing (Principle II: Extensibility).

**Interface**:
- `name: string` — Provider identifier ('ollama', 'gemini', etc.)
- `authenticate(config: ProviderConfig): Promise<AuthToken>` — Validate credentials
- `translateToolsToLLM(tools: Tool[]): any` — Convert tools to provider schema
- `callLLM(prompt: string, tools: any[]): Promise<LLMResponse>` — Invoke model
- `parseResponse(response: LLMResponse): ToolSelection | null` — Extract tool call

**TypeScript Definition**:

```typescript
interface AIProvider {
  name: string;
  authenticate(config: ProviderConfig): Promise<void>;
  translateToolsToLLM(tools: Tool[]): any;
  callLLM(prompt: string, tools: any[]): Promise<LLMResponse>;
  parseResponse(response: LLMResponse): ToolSelection | null;
}

interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  modelName: string;
  [key: string]: any; // Provider-specific options
}

interface LLMResponse {
  text?: string;
  toolCalls?: { name: string; args: any }[];
  [key: string]: any;
}

interface ToolSelection {
  toolName: string;
  arguments: any;
}
```

**Implementations**:
- `OllamaProvider` — Local inference via Ollama API (no auth)
- `GeminiProvider` — Google Gemini API (API key auth)

### SpawnConstraints

**Purpose**: Configuration limiting child agent creation (Principle I: Agent-First; safety guardrails).

**Fields**:
- `maxCount: number` — Maximum # of child agents this agent can spawn (default: 100)
- `maxDepth: number` — Maximum nesting level (0 = no spawning, default: 10)
- `allowedTypes: string[]` — Array of permitted child agent template names (default: [] = any allowed)

**TypeScript Definition**:

```typescript
interface SpawnConstraints {
  maxCount: number;
  maxDepth: number;
  allowedTypes: string[]; // Permitted child config names/IDs
}

// Validation: framework rejects spawn if:
// - Current spawn count >= maxCount
// - Current depth + 1 > maxDepth
// - Child config name not in allowedTypes (if non-empty)
```

### AgentFactory

**Purpose**: Builder/constructor for agent instantiation (Principle I: easily instantiable).

**Interface**:
- `constructor(config: AgentConfig)` — Take provider + tools + constraints
- `build(): Promise<Agent>` — Create and validate agent; throw if provider unavailable (fail-fast per spec)

**AgentConfig**:
- `id?: string` — Agent ID (auto-gen if omitted)
- `provider: ProviderConfig` — AI provider configuration
- `tools: Tool[]` — Available tools
- `spawnConstraints?: Partial<SpawnConstraints>` — Optional spawn limits (defaults applied)

**TypeScript Definition**:

```typescript
interface AgentConfig {
  id?: string;
  provider: ProviderConfig;
  tools: Tool[];
  spawnConstraints?: Partial<SpawnConstraints>;
}

class AgentFactory {
  constructor(config: AgentConfig);
  build(): Promise<Agent>;
}
```

### AgentSession

**Purpose**: Lifecycle + state container for spawned child agent (Principle I: traceable lifecycle).

**State**:
- `sessionId: string` — UUID for this spawn session
- `agent: Agent` — Runtime agent instance
- `parentId: string` — Parent agent ID (for cascading termination)
- `currentDepth: number` — Nesting level (tracked for maxDepth enforcement)
- `spawnCount: number` — # of children spawned by this agent (tracked for maxCount enforcement)
- `createdAt: number` — Timestamp (for lifecycle tracking)
- `terminatedAt?: number` — Timestamp when terminated

**Methods**:
- `send(message: Message): Promise<Message>` — Route message to agent
- `terminate(): Promise<void>` — Kill agent + cleanup; cascade to children
- `isAlive(): boolean` — Check if still running

**TypeScript Definition**:

```typescript
interface AgentSessionState {
  sessionId: string;
  parentId: string;
  agentId: string;
  currentDepth: number;
  spawnCount: number;
  createdAt: number;
  terminatedAt?: number;
}

class AgentSession {
  constructor(agent: Agent, parentId: string, currentDepth: number);
  send(message: Message): Promise<Message>;
  terminate(): Promise<void>;
  isAlive(): boolean;
  inspect(): AgentSessionState;
}
```

## Relationships

```
┌─────────────────────────────────────────┐
│       Agent (runtime)                    │
│ ┌──────────────────────────────────────┐ │
│ │ provider: AIProvider                 │ │
│ │ tools: Tool[] (strict isolation)    │ │
│ │ spawnConstraints: SpawnConstraints  │ │
│ │ activeChildren: Map<id, Session>    │ │
│ └──────────────────────────────────────┘ │
│                  ▲                        │
│              creates                      │
│                  │                        │
└──────────────────┼────────────────────────┘
                   │
         AgentFactory.build()  (Principle I)
                   │
        ┌──────────┴──────────┐
        │                     │
   1x spawn_agent         Tool[] (user-defined)
   built-in                 +
   (Principle I)        Schema validation
                       (Principle IV)
        │                     │
        └────────┬────────────┘
                 │
           Message protocol
           (Principle II)
           { id, sender, recipient,
             type, payload, timestamp,
             context?, error? }
                 │
        ┌────────┴────────┐
        │                 │
   Each agent        Serializable via
   listens +            .inspect()
   responds          (Principle V)
```

## State Serialization

Each entity has a `.inspect()` method returning machine-readable JSON (Principle V: Observability):

```typescript
interface AgentState {
  id: string;
  provider: { name: string; modelName?: string };
  tools: { name: string; description: string }[];
  spawnConstraints: SpawnConstraints;
  activeChildren: AgentSessionState[];
  messageHistorySummary?: {
    total: number;
    recent?: Message[];
  };
}
```

---

**Status**: ✅ **Phase 1 Data Model Complete**  
All entities align with Constitution principles (I–V). Proceed to contracts generation →
