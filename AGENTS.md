# Arbeitslag — AI Agent Framework

**arbetslag** (Swedish: "work team") is a TypeScript framework for building tool-using AI agents with sub-agent delegation.

## Architecture

```
src/
├── index.ts                  # Public API exports
├── agents/
│   └── agentLoader.ts        # Loads agent templates from JSON files
└── model/
    ├── context.ts            # Shared context (providers, tools, FS, templates, config)
    ├── agent.ts              # Agent class — wraps a template, manages tool instances
    ├── session.ts            # Session tracking (agents, message recording)
    ├── aiProvider/
    │   ├── index.ts          # Abstract AIProvider — tool-call loop (up to 128 iterations)
    │   ├── openai.ts         # OpenAI-compatible provider (OpenAI SDK)
    │   └── ollama.ts         # Ollama provider
    ├── fileSystem/
    │   ├── index.ts          # FileSystem interface
    │   ├── nodefs.ts         # Node.js fs implementation (sandboxed to a base dir)
    │   └── inMemory.ts       # In-memory FS (for testing)
    └── tool/
        ├── index.ts          # Abstract Tool<ISchema, Output> (Zod-based schemas)
        ├── fileSystem.ts     # Write, Read, Replace, List, Delete
        ├── http.ts           # HttpRequest (fetch wrapper, large responses saved to file)
        ├── subagent.ts       # ListTemplates, Spawn, Await
        ├── getTime.ts        # GetTime
        └── cronJob.ts        # CreateCronJob (cron-job.org API)
```

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

## Tool Summary

| Tool | Schema | Description |
|------|--------|-------------|
| `writeDocument` | path, content | Write a new file |
| `readDocument` | path, offset?, length? | Read a file (supports byte-range reads) |
| `editDocument` | path, offset, length, content | Replace a byte range in a file |
| `listDocuments` | path | List files in a directory |
| `deleteDocument` | path | Delete a file |
| `httpRequest` | url, method?, headers?, body?, maxBodyLength? | Make HTTP requests (large responses saved to file) |
| `listAgentTemplates` | — | List available agent templates |
| `spawn` | template_name, prompt | Spawn a sub-agent |
| `await` | agent_id | Wait for a sub-agent to finish |
| `getTime` | — | Get current date/time |
| `createCronJob` | enabled, url, schedule | Create a cron job via cron-job.org API |

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
