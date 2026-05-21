# arbetslag — Domain Glossary

## arbetslag

A TypeScript agent framework. Provides the core abstractions for building, orchestrating, and running AI agents. Ships with some built-in tool implementations (HTTP, time, Telegram, sub-agent spawning) but is designed as a general-purpose framework.

## Agent

A running instance of an AI agent. Has a unique ID, a template (defining its personality/capabilities), and a message history. Agents process events and interact with the world through tools.

Agents communicate with each other via tools (e.g., `spawn`). They share the same chat, runtime, and filesystem, but each agent has its own isolated context (message history, state).

**Immortal**: Agents live forever once created. The `AgentRepository` is append-only — agents are never destroyed.

## Template

A recipe for creating agents. Specifies which AI provider and model to use, the system prompt, and which tools the agent is allowed to use.

**Static**: Templates are defined at startup and never change. Existing agents keep their original template; new agents get the current (unchanging) version.

## AI Provider

An abstraction over an LLM service. Takes a message history and a list of tools, returns a completion result (text + optional tool calls).

**Multi-provider**: Support for OpenAI, Anthropic, Google, local models, etc. A single `Context` can contain multiple AI providers — different agents can use different providers.

## Tool

A callable capability an agent can use. Has a name, description, input schema (Zod), and a `call` method that executes against the shared `Context`.

Tools can have side effects — pushing events, writing files, spawning agents. They are the agent's primary interaction mechanism with the world.

## Chat

A group conversation. Connects one or more agents with one or more users in a shared conversation space. When a user sends a message to a new chat, a default entry agent is created for it.

**Group context**: A chat is the shared space where agents and users interact. The `entry_agent_id` designates which agent handles messages for that chat.

## Event

A unit of work in the system. Four kinds:

- **message** — a user message into a chat
- **tool_call** — the agent requesting a tool invocation
- **tool_response** — the result of a tool call
- **api_callback** — an external API callback

Events flow through a queue and are processed one at a time.

## Input Adopter

A component that converts external service updates (Telegram, Slack, HTTP webhooks, etc.) into framework `Event` objects. Supports a generic adapter pattern — any external service can be adapted.

## Context

The full runtime environment passed to every tool and agent method. Formed by combining `Config` (immutable infrastructure) and `State` (mutable runtime data).

**Host-controlled lifecycle**: The host program creates the Context, feeds events, calls `stepUntilIdle`, and handles checkpointing. The framework does not own the processing loop.

## Config

The immutable infrastructure layer of the Context. Contains AI providers, repositories (agent templates, tools), user config (API keys, bot tokens), file system, and output handler registry. Set when the Context is created and never changes during execution.

## State

The mutable runtime data that changes during agent execution. Contains agent repositories, chat repositories, the event queue, and per-tool state.

**Mutable**: Unlike `Config`, the `State` is modified as agents process events — agents are spawned, chats evolve, events are consumed. The framework handles serialization and checkpointing of the `State`.

- `toolState`: Per-tool mutable state for persistence across invocations. Each tool manages its own data independently.

## Orchestrator

The event loop. Processes events from the queue one at a time via `step()`, repeating until the queue is empty (`stepUntilIdle`).

**Serverless model**: The program starts when an external event arrives, processes events until idle (or until stopped), and can be persisted/restored mid-processing. Single-threaded (JavaScript). External events can arrive while processing. The program may be stopped before the queue is fully drained — state must be serializable and restorable.

**Automatic checkpointing**: After each `step` completes, the framework automatically persists state so the program can be restarted safely.

**Error handling**: Fail fast. Any unhandled error crashes the processing cycle. State is checkpointed, and the host program decides whether to restart, recover, or alert.
