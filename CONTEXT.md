# arbetslag — Domain Glossary

## arbetslag

A TypeScript agent framework. Provides the core abstractions for building, orchestrating, and running AI agents. Ships with some built-in tool implementations (HTTP, time, Telegram, sub-agent spawning) but is designed as a general-purpose framework.

## Agent

A running instance of an AI agent. Has a unique ID, a template (defining its personality/capabilities), and a message history. Agents process events and interact with the world through tools.

**Actor**: An Agent is an actor. It owns its own **inbox** — the queue of Events targeted at it. An agent processes its inbox one event at a time; different agents process concurrently. The inbox is live-only: it is never serialized.

**Inbox ordering**: plain FIFO — derived events are appended to the tail of the same inbox, so a burst of user messages is answered strictly in turn (each reply sees only the messages up to it); events pushed while the agent is busy queue behind what is already there.

Agents communicate with each other via tools (e.g., `spawn`). They share the same chat, runtime, and filesystem, but each agent has its own isolated context (message history, state).

**Immortal**: Agents live forever once created. The `AgentRepository` is append-only — agents are never destroyed.

### AI Provider

An endpoint which can provide AI chatting service.

## Template

A recipe for creating agents. Specifies which AI provider and model to use, the system prompt, and which tools the agent is allowed to use.

**Static**: Templates are defined at startup and never change. Existing agents keep their original template; new agents get the current (unchanging) version.

## Compact

Compaction of an Agent's history to keep it within the template's compact threshold. Triggered automatically before each LLM completion request (when the metered size crosses the threshold) or manually by the user (always runs). Both share one pipeline.

Two levels, escalating in cost:

- **Rule-level**: deterministic, no LLM call. Stubs out bulky tool-call arguments and tool results below the waterline; assistant and user text is never touched. Idempotent.
- **LLM-level**: used when rule-level alone cannot bring the history below the threshold. Summarizes the entire below-waterline history (via the agent's own template model) into a single rolling summary, which is merged into the system entry (`history[0]` = system prompt + summary). On later compaction the previous summary is re-summarized along with newly-aged rounds — there is never more than one summary.

### Waterline

The boundary separating compactable old history from the retained recent rounds. The last N rounds (template-configured) stay untouched at both levels.

### Round

One user-initiated exchange: a user entry (user message, agent_message, or api_callback) plus all assistant and tool entries it triggers, up to the next user entry. Compaction boundaries always fall on round boundaries, so an assistant message with tool_calls is never separated from its tool results.

### Compacted

A notice that an agent's history was compacted — an agent-scoped fact (the before/after token counts are that agent's) that the orchestrator routes to the user through the chat channel on the agent's behalf. As opposed to AgentOutput, which is the agent's (LLM's) own utterance. Routed through the same OutputRouter, distinguishable by type.

## Meta System Prompt

A short framework-owned English paragraph appended to every agent's system entry (`history[0]`), telling the LLM what the built-in input wrappers `<agent_message>` and `<api_callback>` mean, so behavior doesn't drift with the model's guess at the tag names. `composeSystemPrompt` is the single composition point shared by agent creation, the deserialize backfill and LLM-level compaction, so the meta prompt survives compaction and agents persisted before it existed are fixed on load. `template.systemPrompt` stays purely app-controlled.

## AI Provider

An abstraction over an LLM service. Takes a message history and a list of tools, returns a completion result (text + optional tool calls).

**Multi-provider**: Support for OpenAI, Anthropic, Google, local models, etc. A single `Context` can contain multiple AI providers — different agents can use different providers.

## Tool

A callable capability an agent can use. Has a name, description, input schema (Zod), and a `call` method that executes against the shared `Context`.

Tools can have side effects — pushing events, writing files, spawning agents. They are the agent's primary interaction mechanism with the world.

## Chat

A group conversation. Connects one or more agents with one or more users in a shared conversation space. When a user sends a message to a new chat, a default entry agent is created for it.

**Group context**: A chat is the shared space where agents and users interact. The `entry_agent_id` designates which agent handles messages for that chat.

## Reply

A chat message that quotes an earlier message in the same chat. The LLM sees the quoted content as a self-contained block inside the message: quoted text is inlined (truncated when long), a quoted sticker is rendered as its emoji, and a quoted photo is included as the image itself.

## Event

A unit of work in the system. Two directions:

- **User-initiated**: `message` (a user message into a chat), `api_callback` (an external API callback), `agent_message` (a message from another agent), `compact_request` (a user-requested compaction).
- **Agent-generated**: `llm_completion_request` / `llm_completion_response` (an LLM round-trip), `tool_call_request` / `tool_call_response` (a tool round-trip), `agent_output` (the agent's reply, routed to the chat).

An event is routed to the target **Agent**'s inbox at push time: user-initiated events target a chat (its entry agent) or a named agent, and agent-generated events always target the agent that generated them. Events for one agent are processed one at a time in inbox order, and different agents process concurrently (see Orchestrator).

## Input Adopter

A component that converts external service updates (Telegram, Slack, HTTP webhooks, etc.) into framework `Event` objects. Supports a generic adapter pattern — any external service can be adapted.

## Context

The full runtime environment passed to every tool and agent method. Formed by combining `Config` (immutable infrastructure) and `State` (mutable runtime data).

**Framework-driven lifecycle**: The host program creates the Context and pushes events; the framework owns dispatch (the Orchestrator routes events to agent inboxes, and agents drive their own loops). `stepUntilIdle` is a wait for idle, not a driver.

## Config

The immutable infrastructure layer of the Context. Contains AI providers, repositories (agent templates, tools), user config (API keys, bot tokens), file system, and output handler registry. Set when the Context is created and never changes during execution.

## State

The mutable runtime data that changes during agent execution. Contains agent repositories, chat repositories, the orchestrator's live agent table, and per-tool state.

**Mutable**: Unlike `Config`, the `State` is modified as agents process events — agents are spawned, chats evolve, events are consumed. The framework handles serialization and checkpointing of the `State`.

- `toolState`: Per-tool mutable state for persistence across invocations. Each tool manages its own data independently.

## Orchestrator

The event loop. `push(event)` synchronously routes the event to the target **Agent** (`receive`), which appends it to the agent's inbox and wakes the agent's self-driving loop; the loop pops one event at a time, runs the dispatch state machine, appends the derived events to the same inbox, and checkpoints the agent after each dispatch. Different agents dispatch concurrently (ADR-0004). `stepUntilIdle` waits until no agent loop is running, then reports the first dispatch error collected since the last call.

**Live agent table**: The orchestrator owns the in-memory table of live agents, hydrated from the `AgentRepository` at init time. Routing is synchronous, so two racing messages into a new chat resolve to the same agent: the entry agent is created at routing time (in `push`), not at dispatch time. The default template is resolved once at init — a missing default template fails the orchestrator at startup. Unroutable events (unknown agent id, `api_callback` without `to_agent_id`) are dropped with a warning.

**Long-lived model**: The host keeps one orchestrator for its lifetime. Webhooks push events and return immediately; the agents drive their own dispatch. Single-threaded (JavaScript) — concurrency is between event dispatches, not between threads.

**Automatic checkpointing**: After each dispatch completes, the affected agent is persisted to disk, so the system can be restarted safely at any point. The inboxes themselves are in-memory: an in-flight (already-popped) event is lost on a crash, and remaining work is re-driven from the input source after a restart.

**Error handling**: Fail fast per event, drain per system. A dispatch error is recorded; the agent's loop keeps processing. `stepUntilIdle` reports the error to the host, which decides whether to recover or alert. A single bad event can never wedge the orchestrator.
