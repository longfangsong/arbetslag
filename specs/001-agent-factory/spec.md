# Feature Specification: Agent Factory

**Feature Branch**: `001-agent-factory`  
**Created**: 2026-04-10  
**Status**: Draft  
**Input**: User description: "This project should be a framework which allow the user code to: create agents from 'AI provider' and 'available tools' easily. It should be a dynamic architecture, which means one AI agent can spawn other agents to do stuff (this should be exposed as a pre-defined tool)."

## User Scenarios & Testing *(mandatory)*

### Clarifications

#### Session 2026-04-10

- Q: What is the exact structure of the Message type? → A: Minimal core: `{ id, sender, recipient, type, payload, timestamp, context?, error? }` for portability and extensibility
- Q: How should tools be defined by developers? → A: Structured interface with explicit schemas: `{ name, description, schema: JSONSchema, handler: async (input) => {} }` for type safety and validation; provides clarity vs. JSDoc inference
- Note: AI providers (Gemini, Claude) have built-in tools (e.g., googleSearch). Framework must handle provider-specific tool constraints (e.g., Gemini pre-3 cannot mix provider tools with user-defined tools simultaneously)
- Q: What happens when parent agent dies before child completes? → A: Cascading termination (Option A). Child dies immediately when parent terminates. Predictable semantics align with Node.js child_process defaults.
- Q: When AI provider API is unavailable (network, invalid credentials), how should agent creation behave? → A: Fail fast (Option A). Constructor throws if provider is unreachable or credentials invalid. Developers get immediate feedback; no deferred errors.
- Q: How to handle tool name conflicts in agent hierarchies? → A: Strict isolation (Option A). Each agent uses only tools in its own tool list. Duplicate tool names within single agent rejected at creation time. No shadowing or inheritance; maximum clarity.
- Note: Workflows are **dynamic, not static graphs**. Agents spawn sub-agents at runtime via `spawn_agent` tool. Spawning agent MUST declare spawn constraints: **maxCount** (max # of child agents), **maxDepth** (max nesting), **allowedTypes** (permitted child agent configs). Framework enforces these limits; violations throw errors.

---

### User Story 1 - Create Agent from AI Provider & Tools (Priority: P1)

Developers want to quickly instantiate an AI agent with a chosen provider (OpenAI, Anthropic, Claude, etc.) and a list of available tools. This is the core capability without which nothing else works. A developer should be able to express agent configuration in code and have it ready to accept messages in under 20 lines of setup.

**Why this priority**: Foundation capability; all other features depend on it. Unblocks testing and demonstration of agent behavior.

**Independent Test**: Can be fully tested by instantiating a single agent with one tool, sending a message, and verifying the response follows protocol. Delivers immediate value for single-agent use cases.

**Acceptance Scenarios**:

1. **Given** an AI provider config (API key, model name), **When** creating an agent with one tool defined, **Then** agent is instantiated and ready to process messages
2. **Given** a multi-tool agent definition, **When** sending a message requesting a specific tool, **Then** agent correctly selects and executes the tool
3. **Given** agent receives tool error, **When** tool execution fails, **Then** error is captured and passed back as message payload (not thrown exception)

---

### User Story 2 - Agent Spawning (Dynamic Sub-Agents) (Priority: P1)

Agents should be able to spawn child agents to delegate tasks. A parent agent requests the `spawn_agent` built-in tool with specifications (provider, tools, initial message), receives a session ID, and can send messages to the child. This enables hierarchical and distributed agent networks.

**Why this priority**: Unlocks the "dynamic architecture" requirement; foundational for multi-agent workflows. Critical for complex task decomposition.

**Independent Test**: Can be fully tested by having a parent agent spawn a child, send a message to the child, receive response, and verify parent can clean up the child lifecycle. Demonstrates complete spawning use case.

**Acceptance Scenarios**:

1. **Given** a parent agent has `spawn_agent` tool available, **When** calling spawn with child config, **Then** child agent is created and session ID is returned
2. **Given** parent has spawned a child, **When** parent sends a message to child via session ID, **Then** message arrives and child responds
3. **Given** parent spawns a child with specific tools, **When** child receives message, **Then** tool list is limited to what parent authorized
4. **Given** child agent completes task, **When** parent calls cleanup, **Then** child resources are released and further messages fail gracefully

---

### User Story 3 - Compose Multiple Agents (Priority: P2)

Developers should be able to build dynamic multi-agent workflows where agents collaborate to solve problems. Unlike static task graphs, agents spawn child agents at runtime based on problem decomposition. This includes chains (Agent A → B → C), fan-out (A → {B, C, D}), and hierarchies. Composition patterns should be expressible without framework magic. Each agent that spawns MUST declare spawn constraints (max count, max depth, allowed types) to prevent runaway agent proliferation.

**Why this priority**: High-value but builds on US1 & US2. Extends framework from single-agent to dynamic multi-agent system. Not blocking core feature release. Spawn constraints are critical for production safety.

**Independent Test**: Can be fully tested by defining a dynamic 3-agent chain where A spawns B with constraints (maxCount=1, maxDepth=2), B spawns C respecting those limits, C completes a task and returns result through B to A. Demonstrates dynamic composition with controlled spawn behavior.

**Acceptance Scenarios**:

1. **Given** multiple agents in a composition, **When** one agent fails, **Then** error propagates to caller and other agents remain operable
2. **Given** a fan-out scenario where one agent spawns 3 children with maxCount=3, **When** all children complete, **Then** parent receives all results
3. **Given** agents communicate through protocol, **When** message volume is high, **Then** ordering and delivery are guaranteed
4. **Given** an agent tries to spawn a child exceeding its maxCount limit, **When** spawn is attempted, **Then** framework rejects spawn with error (not silent failure)
5. **Given** an agent tries to spawn at depth > maxDepth, **When** spawn is attempted, **Then** framework rejects spawn; error surfaced to parent

---

### Edge Cases

- What happens when AI provider API is unavailable? (RESOLVED: Fail fast — agent constructor throws if provider unreachable or credentials invalid; developers get immediate feedback)
- How does framework handle tool name conflicts across spawned agents? (RESOLVED: Strict isolation — each agent uses only its own tool list; duplicate names within single agent rejected at creation; no shadowing or inheritance)
- What happens when spawned agent's parent dies before child completes? (RESOLVED: Cascading termination — child dies immediately when parent terminates; predictable semantics)
- What happens when a tool tries to recursively spawn itself or exceed spawn limits? (RESOLVED: Spawn constraints block proliferation — agent declares maxCount, maxDepth, allowedTypes; framework enforces; violations throw errors; recommendation for reasonable defaults: maxCount=100, maxDepth=10, allowedTypes=[] (any))

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Framework MUST provide factory function to create agents from AI provider config + tool list
- **FR-001a**: Agent factory constructor MUST validate and connect to AI provider synchronously; throw error if provider unreachable or credentials invalid
- **FR-002**: Framework MUST support multiple AI providers (OpenAI, Anthropic, etc.) with pluggable adapters
- **FR-003**: Agents MUST expose a built-in `spawn_agent` tool that creates child agents with specified config
- **FR-003a**: Framework MUST support both user-defined tools and AI provider's built-in tools; document provider-specific constraints (e.g., tool mixing limitations) in adapter configuration
- **FR-003b**: Framework MUST enforce strict tool isolation: each agent uses only tools in its own tool list; duplicate tool names within single agent MUST be rejected at agent creation time
- **FR-003c**: Agent spawn constraints MUST be configurable: `maxCount` (max # children), `maxDepth` (max nesting depth), `allowedTypes` (array of permitted child agent type names/IDs). Framework MUST enforce limits; spawn attempts exceeding limits MUST throw errors
- **FR-003d**: `spawn_agent` tool MUST validate child config against parent's spawn constraints BEFORE creating child; reject if violates maxCount, exceeds maxDepth, or child config not in allowedTypes
- **FR-004**: Spawned agents MUST operate as independent processes/workers with isolated state
- **FR-005**: Messages between agents MUST flow through explicit protocol (no shared memory)
- **FR-006**: Tool execution failures MUST surface as message payloads, not thrown exceptions
- **FR-007**: Agents MUST expose a `.inspect()` method returning serializable state (aligns with Constitution principle V)
- **FR-008**: Spawned agents MUST inherit logging/observability configuration from parent
- **FR-009**: Agent lifecycle (create → run → terminate) MUST be explicit and traceable
- **FR-010**: Framework MUST provide a shutdown mechanism that cleanly terminates child agents recursively through cascading termination (child dies when parent dies)

### Key Entities

- **Agent**: Core runtime entity that receives messages, selects tools, executes them, and sends responses. Stateful, independently operable, introspectable.
- **AIProvider**: Configuration + adapter for connecting to LLM backends (OpenAI, Anthropic, custom). Handles authentication, model selection, request/response translation.
- **Tool**: Structured definition with explicit contract: `{ name: string, description: string, schema: JSONSchema, handler: async (input: any) => any }`. Enables type validation, LLM prompt generation, and contract testing. Framework distinguishes **User-Defined Tools** (created by developer) from **Provider Tools** (built-in to AI provider like Gemini's googleSearch).
- **Message**: Typed request/response unit. Core structure: `{ id: string, sender: string, recipient: string, type: string, payload: any, timestamp: number, context?: object, error?: object }`. Minimal design for portability; context object allows agent-specific extensions. Error field captures tool/execution failures as payloads (not exceptions).
- **AgentFactory**: Builder/constructor that takes provider config + tools + spawn constraints and returns instantiated Agent. Spawn constraints: `maxCount` (max child agents spawnable), `maxDepth` (max nesting level; 0 = no spawning), `allowedTypes` (array of permitted child agent configurations; empty = any type allowed).
- **AgentSession**: Lifecycle container for spawned agent, including cleanup signals and message routing. Tracks current spawn count and nesting depth to enforce constraints.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can create a functional agent with 1 AI provider + 3 tools in under 50 lines of code (measured via example in docs)
- **SC-002**: Framework successfully spawns and manages 100+ concurrent child agents without message loss or corruption
- **SC-003**: Agent spawn operation completes within 100ms on standard hardware (p95 latency)
- **SC-004**: Multi-agent workflows (3+ agent chains) execute with zero message ordering violations
- **SC-005**: 95% of developers with basic Node.js/TypeScript knowledge can implement a 3-agent workflow from documentation in under 1 hour
- **SC-006**: Spawn constraint violations (maxCount, maxDepth, allowedTypes) are caught and rejected before agent creation with clear error messages

## Assumptions

- **AI Provider Integration**: REST APIs or official SDKs provided by AI providers (OpenAI, Anthropic, Gemini) are the primary integration points; custom providers can be added via adapter pattern
- **Provider Tool Constraints**: Some AI providers have built-in tools (e.g., Gemini's googleSearch, Claude's file operations). Each provider may have constraints blocking simultaneous use of provider tools + user-defined tools. Framework adapter MUST document these constraints; developers choose one category per agent or split across multiple agents
- **Single Machine Deployment**: Initial release targets single machine or single worker thread pool; distributed multi-machine agent coordination is out of scope for v1
- **Dynamic Workflow Architecture**: Workflows are not static graphs. Agents spawn child agents at runtime based on problem decomposition. This enables flexible task delegation but requires spawn constraints to prevent runaway proliferation. Default constraints: `maxCount=100, maxDepth=10, allowedTypes=[]` (any type allowed unless restricted)
- **Message Persistence**: Messages are not persisted to external storage by default; agent developers must add persistence layer if needed
- **Tool Execution**: Tools are assumed to be synchronous or return promises; streaming responses from tools are out of scope for initial release
- **Resource Management**: Parent agent is responsible for enforcing resource limits (concurrency, memory) on spawned children; framework provides observability hooks only
- **Authentication**: Each AI provider requires explicit credentials; framework does not manage credential rotation or secret vault integration
- **Error Semantics**: Tool errors captured in message payload; all agent-to-agent communication failures are recoverable (retryable) or surfaced to parent
- **Development Environment**: Framework assumes Node.js 20+ with TypeScript strict mode; CommonJS deployments not supported
