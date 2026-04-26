# Arbeitslag — AI Agent Framework

**arbetslag** (Swedish: "work team") is a TypeScript framework for building tool-using AI agents with sub-agent delegation.

## Core Concepts

### Context
The shared dependency container. Holds AI providers, tool constructors, a `FileSystem`, agent templates, and arbitrary config. Agents resolve tools and providers from context at construction time.

### Agent Templates (JSON)
Agents are defined as JSON configs in a directory (e.g. `examples/configs/`):
- `name` / `description` — identifier and purpose
- `provider` / `model` — which AI provider and model to use
- `systemPrompt` — the system message
- `tools` — array of `{ name, metaParameters? }` specifying which tools the agent gets

Templates are loaded via `loadTemplates(dir)` and resolved by name from `Context`.

### Agent
Instantiated from a `Context` + `Template`. Resolves tool constructors and provider at construction. `handleRequest()` kicks off the provider's tool-call loop, which iterates up to 128 times: call LLM → execute tool calls → append results → repeat until no tool calls remain.

### Session
Tracks agents involved in a conversation and records message histories to the file system (`run/{sessionId}/{agentId}.json`).

### AI Provider Loop (`AIProvider.sendMessage`)
Abstract base class implements the agentic loop. Concrete providers (`OpenAIProvider`, `OllamaAIProvider`) implement provider-specific message formatting, API calls, and response parsing.

### Sub-Agent Delegation
- `listAgentTemplates` — lists available agent templates
- `spawn` — creates a new agent from a template with a given prompt; returns the agent ID. Enforces `maxDepth` to prevent infinite nesting.
- `await` — waits for a spawned agent to complete and returns its result.

### File System Abstraction
`FileSystem` interface with `readFile`, `writeFile`, `editFile`, `listFiles`, `deleteFile`. Two implementations:
- `NodeFsFileSystem` — real filesystem, sandboxed to a base directory
- `InMemoryFileSystem` — in-memory map, for testing

## Build & Development

```bash
pnpm install

pnpm build          # Build with tsdown (ESM + CJS, with .d.ts)
pnpm dev            # Watch mode
pnpm test           # Vitest
pnpm lint           # Biome lint (auto-fix)
pnpm format         # Biome format
pnpm type-check     # TypeScript type checking
```

**Tooling:** tsdown (bundler), Biome (lint/format), Vitest (tests), Zod v4 (schemas), TypeScript 6

## Example Usage

See `examples/example.ts` — creates a `Context` with an OpenAI provider, registers all built-in tools, loads templates from `examples/configs/`, instantiates a `taskDispatcher` agent, and runs it against a user prompt.

## Configuration

Agent templates live as JSON files (see `examples/configs/taskDispatcher.json` and `generalPurposeSubAgent.json`). The `taskDispatcher` template demonstrates the multi-agent pattern: it can spawn parallel sub-agents for independent tasks and synthesize results.
