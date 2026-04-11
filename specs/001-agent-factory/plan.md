# Implementation Plan: Agent Factory

**Branch**: `001-agent-factory` | **Date**: 2026-04-10 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/001-agent-factory/spec.md`

## Summary

The Agent Factory is a dynamic multi-agent framework for Node.js that enables developers to:
1. **Create agents** from AI providers (Ollama, Google Gemini, etc.) + user-defined tools with minimal setup (<50 LOC)
2. **Spawn sub-agents** dynamically at runtime with configurable constraints (maxCount, maxDepth, allowedTypes)
3. **Compose workflows** where agents collaborate via protocol-based message passing

**Technical Approach**: Library-first, TypeScript strict mode, edge-runtime compatible. Protocol contracts via JSON schemas. Provider adapters for Ollama (local testing) and Gemini (cloud testing). Packaging via tsup for dual ESM/CJS support + edge runtime tree-shaking.

## Technical Context

**Language/Version**: TypeScript 6.x + Node.js 20+ LTS (edge runtime compatible)  
**Primary Dependencies**: 
  - `tsup` (bundler for ESM + edge runtime)
  - Ollama SDK (local testing) / Google Gemini API (cloud testing)
  - `zod` or similar for JSON schema validation (strict type safety)
  - Biome (linting/formatting)

**Storage**: N/A (agent state managed in-memory; derivatives add persistence)  
**Testing**: Vitest (fast, ESM-native); contract tests via JSON schema validation  
**Target Platform**: Node.js 20+ (standard + Cloudflare Workers, Vercel Edge Functions via esbuild)  
**Project Type**: Library (ESM + dual-runtime)  
**Performance Goals**: 
  - Agent spawn: <100ms p95 (on standard hardware)
  - Support 100+ concurrent child agents
  - Message latency: <50ms p95 (single-machine)

**Constraints**: 
  - No externalized state (single-machine v1)
  - Async-first (Promise/await; no callbacks)
  - Edge runtime: no Node.js-only APIs (fs, net usage must be optional/pluggable)

**Scale/Scope**: 
  - Core library: ~3-4k LOC
  - Two provider adapters: ~500 LOC each
  - Test suite: ~2k LOC

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Core Principles Alignment

| Principle | Requirement | Plan Compliance | Status |
|-----------|-------------|---|--------|
| **I. Agent-First Design** | Agents are primitives; every feature composable | Factory creates agents directly; spawn_agent as built-in tool | ✅ |
| **II. Protocol-Based Communication** | Explicit message contracts; no implicit coupling | Message type via TypeScript interface + JSON schema validation | ✅ |
| **III. Composable & Portable Agents** | Single-file deployable; no main-thread magic | ESM + edge runtime target; agents work over any transport | ✅ |
| **IV. Type Safety (Non-Negotiable)** | TypeScript strict; exhaustive types | zod/json-schema for runtime validation; strict mode enforced | ✅ |
| **V. Observability Built-In** | Structured logging; state inspection; error chains | `.inspect()` method; structured JSON logs; error payloads in messages | ✅ |

**Gates**: ✅ **PASS** — All principles engaged. No violations. Edge runtime compatibility (tsup + esbuild) planned explicitly.

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-factory/
├── spec.md              # Feature specification (completed)
├── plan.md              # This file
├── research.md          # Phase 0 output (upcoming)
├── data-model.md        # Phase 1 output (upcoming)
├── quickstart.md        # Phase 1 output (upcoming)
├── contracts/           # Phase 1 output (upcoming)
│   ├── message.schema.json
│   ├── tool.schema.json
│   └── agent-config.schema.json
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── core/
│   ├── agent.ts              # Agent runtime (message processing, tool execution)
│   ├── factory.ts            # AgentFactory builder + constructor
│   ├── message.ts            # Message type definitions + helpers
│   ├── tool.ts               # Tool interface + validation
│   └── index.ts              # Main exports

├── providers/
│   ├── base.ts               # AIProvider adapter interface
│   ├── ollama.ts             # Ollama local provider adapter
│   ├── gemini.ts             # Google Gemini cloud provider adapter
│   └── index.ts              # Provider registry

├── spawn/
│   ├── spawn-agent.tool.ts   # Built-in spawn_agent tool
│   ├── session-manager.ts    # AgentSession lifecycle + constraints
│   └── index.ts

├── observability/
│   ├── logger.ts             # Structured logging (JSON + human)
│   ├── tracer.ts             # OpenTelemetry integration hooks
│   └── index.ts

└── utils/
    ├── validation.ts         # JSON schema + zod validation
    ├── serialization.ts      # State inspection + serialization
    └── index.ts

tests/
├── unit/
│   ├── agent.test.ts         # Agent message processing
│   ├── factory.test.ts       # Agent creation + validation
│   ├── tool.test.ts          # Tool definition + schema
│   └── spawn-agent.test.ts   # Spawn constraints + cascading termination

├── contract/
│   ├── message.contract.test.ts      # Message protocol validation
│   ├── provider-ollama.test.ts       # Ollama adapter contract
│   ├── provider-gemini.test.ts       # Gemini adapter contract
│   └── tool-execution.test.ts        # Tool execution protocol

├── integration/
│   ├── multi-agent-chain.test.ts     # 3+ agent chains (US3)
│   ├── fan-out.test.ts               # Parent → 3 children (US3)
│   └── dynamic-spawn.test.ts         # Spawn constraints enforcement
```

## Packaging & Distribution

**tsup Configuration** (`tsup.config.ts`):
- **Entry**: `src/core/index.ts` (main), `src/providers/index.ts` (optional)
- **Formats**: ESM (`.js`) + CommonJS (`.cjs`)
- **Target**: `node20, edge-runtime` (esbuild targets)
- **Tree-shaking**: Enabled; providers are optional dependencies
- **Output**: `dist/index.js`, `dist/index.cjs`, `dist/*.d.ts` (type definitions)

**package.json**:
```json
{
  "exports": {
    ".": {
      "types": "./dist/core/index.d.ts",
      "import": "./dist/core/index.js",
      "require": "./dist/core/index.cjs"
    },
    "./providers/ollama": {
      "types": "./dist/providers/ollama.d.ts",
      "import": "./dist/providers/ollama.js"
    },
    "./providers/gemini": {
      "types": "./dist/providers/gemini.d.ts",
      "import": "./dist/providers/gemini.js"
    }
  }
}
```

## Phase 0: Research (Needed Clarifications)

**Questions to Research**:

1. **Message Transport & Serialization**
   - Determine: How are messages serialized between agents? (JSON only vs. binary options)
   - Format: JSON for v1 (universal, debuggable)

2. **Provider Adapter Pattern**
   - Research: Common adapter interface for Ollama + Gemini
   - Decision: Minimal adapter interface; each provider handles auth/request-response translation

3. **Spawn Constraint Propagation**
   - How do child agents inherit/override parent's spawn constraints?
   - Decision: Child must request spawn limits explicitly from parent; no implicit inheritance

4. **Tool Execution Error Handling**
   - When tool throws, how captured + surfaced to agent?
   - Decision: Tool handler wraps exceptions in try-catch; error object passed in Message.error field

5. **Edge Runtime Compatibility**
   - Which Node.js APIs must be avoided? (fs, net, crypto)
   - Decision: Use Web APIs where possible; fs/net behind optional providers

**Deliverable**: `research.md` (completed during Phase 0)

## Phase 1: Design & Contracts

**1. Data Model** (`data-model.md`)

Core entities and their relationships:
- **Agent**: Runtime entity managing message + tool state
- **Message**: Request/response payload with envelope
- **Tool**: Definition + runtime handler
- **AIProvider**: Adapter translating agent tool requests to LLM calls
- **SpawnConstraints**: Configuration limiting child agent proliferation
- **AgentSession**: Lifecycle + session management

**2. Message Protocol Contract** (`contracts/message.schema.json`)

```json
{
  "$schema": "http://json-schema.org/draft-7/schema#",
  "type": "object",
  "properties": {
    "id": { "type": "string", "description": "Unique message ID (UUID)" },
    "sender": { "type": "string", "description": "Sender agent ID" },
    "recipient": { "type": "string", "description": "Recipient agent ID" },
    "type": { "type": "string", "enum": ["request", "response", "error"] },
    "payload": { "type": "object" },
    "timestamp": { "type": "number" },
    "context": { "type": "object" },
    "error": { "type": "object" }
  },
  "required": ["id", "sender", "recipient", "type", "payload", "timestamp"]
}
```

**3. Tool Definition Contract** (`contracts/tool.schema.json`)

```json
{
  "$schema": "http://json-schema.org/draft-7/schema#",
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "description": { "type": "string" },
    "schema": { "$ref": "#/definitions/JSONSchema" },
    "handler": { "type": "string", "description": "Cannot be serialized; type definition only" }
  },
  "required": ["name", "description", "schema"]
}
```

**4. Quickstart Guide** (`quickstart.md`)

Hands-on examples:
- Create agent with Ollama + 1 tool (15 LOC)
- Send message + receive response
- Parent spawns child with constraints
- Multi-agent chain (A → B → C)

**5. Agent Context Update**

Run: `.specify/scripts/bash/update-agent-context.sh copilot`  
Updates GitHub Copilot context with Agent Factory architecture patterns.

## Complexity Tracking

No Constitution violations. Edge runtime requirement adds complexity (tsup + esbuild config) but is manageable via optional provider loading.

### Justification: Multi-Runtime Support

| Aspect | Approach | Why |
|--------|----------|-----|
| **ESM Priority** | Main exports ESM; CJS via tsup dual-build | Native Node.js support; edge runtimes expect ESM |
| **Provider Optional** | Each provider separate export | Avoid bundling unused SDK dependencies (e.g., Gemini SDK not needed for local Ollama) |
| **No fs/net Direct** | Via provider adapters | Edge runtimes don't support Node.js primitives; providers abstract this |

---

## Post-Design Gates (To Re-Evaluate After Phase 1)

1. ✅ **Type Safety**: All message/tool types expressible in TypeScript strict mode
2. ✅ **Protocol Clarity**: JSON schemas match TypeScript interfaces exactly
3. ✅ **Edge Runtime**: tsup config produces working ESM for Cloudflare Workers
4. ✅ **Spawn Safety**: Constraints validated before agent creation

## Next Steps

1. **Phase 0**: Execute research phase (if needed; clarifications mostly complete)
2. **Phase 1**: Generate `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
3. **Phase 2**: `/speckit.tasks` generates implementation tasks ordered by dependency
4. **Implementation**: Follow task list with test-first discipline

---

**Plan Status**: ✅ **Ready for Design Phase (Phase 1)**  
**Constitution Alignment**: ✅ 100%  
**Technical Feasibility**: ✅ High (all requirements standard TypeScript/Node.js patterns)

Proceed to `/speckit.plan` Phase 1 (design + contracts) →
