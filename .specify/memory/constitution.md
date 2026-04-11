# Arbetslag Constitution
<!-- Multi-agent framework library for Node.js -->

## Overview

Arbetslag is a TypeScript-based multi-agent framework library. This constitution establishes non-negotiable principles that all code, design, and deployment decisions must satisfy. It supersedes all other practices, team conventions, and informal agreements.

## Core Principles

### I. Agent-First Design

Agents are first-class primitives in the framework. Every feature must be designed with agent behavior, composition, and scalability as primary concerns. A feature is not complete until it can be composed into multi-agent workflows. Agents must be:

- **Independently instantiable**: Can be created with minimal configuration
- **Message-driven**: All communication happens via well-defined message types
- **State-manageable**: Agents can be inspected, paused, resumed, and serialized
- No features that only serve the framework internals (everything must be usable by end developers)

### II. Protocol-Based Communication

All inter-agent communication flows through explicit, documented protocols. No implicit coupling, shared state, or hidden calls between agents.

- **Message contracts**: Every message type must have TypeScript interfaces defining shape and semantics
- **Error propagation**: Failures surface as message payloads, not exceptions crossing boundaries
- **Extensibility**: New agent types must be addable without modifying core communication layer
- Contracts must be versioned and support backward compatibility for reasonable migration periods

### III. Composable & Portable Agents

Agents must function both standalone and within composite systems. No magic setup or implicit global state.

- **Single-file deployable**: Any agent must be runnable as an isolated Node.js process or worker thread
- **No main-thread coupling**: Agents work over IPC, HTTP, WebSocket without runtime assumptions
- **Storage agnostic**: Agents must support pluggable adapters for persistence (in-memory, Redis, database)
- Composition patterns (pipelines, hierarchies, networks) must be learnable in <30 minutes

### IV. Type Safety (Non-Negotiable)

TypeScript strict mode is enforced. Type safety catches classes of bugs early and serves as machine-checked living documentation.

- **No `any` types** except in clearly documented escape hatches (with //@ts-ignore justification)
- **Exhaustive unions**: All runtime cases must be expressible in types (literals, discriminated unions)
- **Test-driven contracts**: If a type represents an agent interface, contract tests must exist and pass
- Linting (Biome) enforces stricter-than-default rules; exceptions require documented review

### V. Observability Built-In

Agents must be debuggable. All execution decisions, message flows, and state transitions must be visible.

- **Structured logging required**: Every log message includes context (agent ID, message type, timestamp). JSON format available
- **Tracing support**: Integration points for OpenTelemetry or similar; no vendor lock-in
- **State inspection API**: All agents expose a `.inspect()` method returning serializable state snapshots
- **Error chains**: Stack traces must preserve causality; context lost in async chains must be recoverable

## Technology & Code Quality

### Language & Runtime

- **TypeScript 6.x strict mode** (or later compatible major version)
- **Node.js 20+ LTS** (as of 2026; update with LTS releases)
- **ESM modules only** (no CommonJS); package.json `"type": "module"`
- **pnpm workspaces** for monorepo package management (if multi-package)

### Dependencies & Stability

- **Minimize production dependencies**: Only add if agent composition/communication directly requires it
- **No peer-dependency hell**: Dependencies must have clear version constraints
- **Dev/peer separation**: Testing libraries, type definitions stay in devDependencies
- **Explicit re-exports**: No barrel exports hiding what's actually consumed

### Code Quality & Linting

- **Biome in strict mode** for formatting and linting (configured in biome.json)
- **100% test coverage baseline**: New code without tests does not ship (exceptions documented)
- **No console.log in production code**: Use structured logging only
- **PR review requirement**: No commits to main without peer review + passing CI

### Testing Discipline (Non-Negotiable)

- **Unit tests**: Documented in `agent/filename.test.ts` alongside source
- **Contract tests**: Message flows validated separately from internal logic
- **Integration tests**: Multi-agent workflows tested as a unit (sample scenarios included)
- **Setup**: `pnpm test` must run all tests; coverage reports generated with every run

## Development Workflow

### Branch & Commit Discipline

- **Feature branches**: `[ID]-[description]` (e.g., `001-agent-lifecycle`)
- **Commit messages**: Conventional Commits format (feat, fix, docs, test, refactor, chore)
- **Before commit**: Run `pnpm test` and `pnpm lint`—PR requirements catch everything else
- **Release notes**: Changelog driven from commit types; semver bumps are mechanical

### API & Breaking Changes

- **Semantic Versioning** (MAJOR.MINOR.PATCH) strictly enforced
- **MAJOR bumps**: Breaking protocol changes, removed agent types, contract deletions (rare)
- **MINOR bumps**: New agent capabilities, new message types, new extensions (backward-compatible)
- **PATCH bumps**: Bug fixes, documentation, internal refactors
- **Deprecation window**: At least one MINOR release before removing deprecated APIs; marked with `@deprecated` JSDoc

### Documentation Requirements

- **README.md**: Quick start + links to guides
- **docs/agents/**: One page per built-in agent type (constructor, message types, examples)
- **docs/protocols/**: Message type definitions with examples
- **Code comments**: Non-obvious logic explained; architecture decisions recorded
- **Changelog**: Entries for every version with highlighted breaking changes

## Governance

**Constitution is the source of truth** for acceptance criteria, code review, and release decisions. All PRs must cite which principles they satisfy.

### Amendment Procedure

1. Propose rationale and new/modified principle(s) via issue or discussion
2. Core team discusses; rationale must be based on empirical pain points or clear design gaps
3. Amendment documented in markdown with version bump rationale
4. `LAST_AMENDED_DATE` updated; `CONSTITUTION_VERSION` bumped per semver rules
5. All dependent templates (spec, plan, tasks) validated for consistency

### Compliance & Review

- **Principle citations in PRs**: Reviewers check that design decisions align with principles
- **API reviews**: New agent types and message protocols require explicit sign-off
- **Release gate**: At least one core maintainer must verify compliance before version bump
- **Quarterly review**: Constitution re-examined against actual codebase; adjustments if reality diverges

### Runtime Development Guidance

See [GUIDANCE.md](./GUIDANCE.md) for day-to-day practices, tool configuration, and debugging tips. GUIDANCE.md is written by maintainers and can evolve freely; CONSTITUTION.md represents binding project intent.

---

**Version**: 1.0.0 | **Ratified**: 2026-04-10 | **Last Amended**: 2026-04-10
