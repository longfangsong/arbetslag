# arbetslag — Domain Glossary

## arbetslag

A TypeScript agent framework. Provides the core abstractions for building, orchestrating, and running AI agents. Ships with some built-in tool implementations (HTTP, time, Telegram, sub-agent spawning) but is designed as a general-purpose framework.

## Agent

A running instance of an AI agent. Has a unique ID, a template (defining its personality/capabilities), and a message history. Agents process events and interact with the world through tools.

Agents communicate with each other via tools. They share the same chat, runtime, and filesystem, but each agent has its own isolated context (message history, state).

**Immortal**: Agents live forever once created. The `AgentRepository` is append-only — agents are never destroyed. Sub-agents are included: creating one adds a permanent agent.

### Sub-agent

An Agent created by another Agent. It is not a separate kind of entity — it is an ordinary Agent with a creator link.

A Sub-agent works on a task handed to it and reports its result to its creator, not to the user. It is defined by a pre-declared Template, so it has no personality of its own beyond that Template.

_Avoid_: "sub-agent" as a distinct entity type; Worker, Task, Job.

### Creator

The Agent that created a Sub-agent. A Sub-agent has exactly one Creator, and reports its result to that Creator.

_Avoid_: Parent — implies a lifecycle where the child ends, which contradicts immortality.

### Report

The result a Sub-agent delivers to its Creator — the content of the turn it ends with.

**Wait-only**: a Creator receives a Report only through a Wait. A Report that arrives while no Wait is open is held for the Creator until a Wait naming that Sub-agent consumes it.

_Avoid_: Output, Result — Output is the agent's utterance toward the user (AgentOutput), which a Sub-agent never produces.

**Creation is immediate**: a Creator is not blocked by creating a Sub-agent — the create call completes at once, and the Creator may then Wait for the Sub-agent's report.

**Wait**: a Creator waits only for the reports of the Sub-agents it asked for, and a Wait does not stop other work from being processed — the loop keeps draining while the Creator waits. A Wait resolves when the Sub-agent delivers its final answer (or reports failure), and a Wait survives a checkpoint and restart. A Wait is never interrupted by a new message.

**Same Chat**: a Sub-agent belongs to its Creator's Chat, and shares the runtime and filesystem as any Agent does.

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

A unit of work in the system. Four kinds:

- **message** — a user message into a chat
- **tool_call** — the agent requesting a tool invocation
- **tool_call_response** — the result of a tool call
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

**Error handling**: Fail fast. Any unhandled error crashes the processing cycle. State is checkpointed, and the host program decides whether to restart, recover, or alert. Sub-agent failures are an exception: they reach the Creator as a report rather than crashing the cycle.

## Flagged ambiguities

- "sub-agent" was used to mean a distinct entity type — resolved: it is an ordinary Agent with a Creator.
- "Parent" vs "Creator" — resolved: **Creator**, because agents are immortal and never destroyed.
- Tool names (`spawn`, `await`, `send_message`) are implementation, not domain language. Only the *behavior* (immediate creation, Wait, per-Template enabling) is a requirement.
- Backlog, not a requirement yet: a Sub-agent communicating with the outside world through a tool.
