# Tasks: Agent Factory

**Input**: Design documents from `specs/001-agent-factory/`  
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/, research.md  
**Notation**: `[ID] [P?] [Story?] Description` where [P] = parallelizable, [Story] = user story (US1/US2/US3)

## Implementation Strategy

**MVP Scope** (Phase 1-4): Single-machine agent creation + spawning + basic composition
- US1 (P1): Create Agent — Core runtime
- US2 (P1): Agent Spawning — spawn_agent tool + constraints
- US3 (P2): Multi-Agent Composition — chains + fan-out (deferred to later, uses US1+US2)

**Execution Path**: Setup → Foundational → US1 → US2 → US3 → Polish

**Test-First Discipline**: Contract tests written before implementation; unit tests alongside features; integration tests after composition works.

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Configure build, packaging, linting, testing infrastructure

- [X] T001 Create project structure per implementation plan (src/, tests/, specs/)
- [X] T002 [P] Initialize TypeScript strict config with tsconfig.json (target es2020, module esnext)
- [X] T003 [P] Configure tsup bundler (ESM + edge runtime targets, dual ESM/CJS output)
- [X] T004 [P] Setup Biome linting (strict rules, enforce no console.log in production)
- [X] T005 [P] Initialize Vitest test runner with @vitest/ui coverage reporting
- [X] T006 [P] Configure package.json with exports for core + provider subpaths (./providers/ollama, ./providers/gemini)
- [X] T007 [P] Setup GitHub Actions CI (test + lint on PR; coverage >95% gateway)
- [X] T008 Create README.md with quickstart (single agent + Ollama example <50 LOC target)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure all user stories depend on

- [x] T009 Define core types in src/core/types.ts (Agent, Message, Tool, AIProvider, SpawnConstraints, AgentConfig interfaces)
- [x] T010 [P] Implement Message type + factory in src/core/message.ts with validation against contracts/message.schema.json
- [x] T011 [P] Implement Tool interface + schema validation in src/core/tool.ts (JSONSchema validation via zod/ajv)
- [x] T012 [P] Implement SpawnConstraints type + validation in src/core/spawn-constraints.ts (maxCount, maxDepth, allowedTypes)
- [x] T013 Create AIProvider base adapter interface in src/providers/base.ts (authenticate, translateToolsToLLM, callLLM, parseResponse)
- [x] T014 [P] Implement structured logging in src/observability/logger.ts (JSON + human fallback; context metadata per message)
- [x] T015 [P] Implement .inspect() serialization utilities in src/utils/serialization.ts (agents + sessions → JSON state snapshots, Principle V)
- [x] T016 Create contract tests framework in tests/contract/ (JSON schema validation helpers)

---

## Phase 3: User Story 1 - Create Agent from AI Provider & Tools (P1)

**Goal**: Single agent can be created with provider + tools, receive message, execute tool, return response  
**Independent Test**: Instantiate agent, send message, verify response follows protocol and tool executes correctly

### 3a: Core Agent Runtime

- [x] T017 [US1] Implement Agent class in src/core/agent.ts with:
  - Constructor taking provider + tools + spawn constraints
  - Message receiver: `receive(message: Message): Promise<Message>`
  - Tool executor with error handling (try-catch → error payload)
  - State: id, provider, tools, messageHistory, activeChildren, isRunning
- [x] T018 [P] [US1] Implement Agent.inspect() method returning AgentState (Principle V observability)
- [x] T019 [US1] Implement message routing in agent (sender/recipient validation, type dispatch: request/response/error)
- [x] T020 [US1] Implement tool selection from message payload (match tool name from agent.tools, reject if not found)

### 3b: AgentFactory & Initialization

- [ ] T021 [US1] Implement AgentFactory class in src/core/factory.ts:
  - Constructor takes AgentConfig (provider config + tools + spawn constraints)
  - build() validates + creates agent
  - Fail-fast: throw if provider unreachable or credentials invalid
- [ ] T022 [US1] Implement provider instantiation in factory (resolve provider by name, validate config schema)
- [ ] T023 [US1] Implement tool validation in factory (reject duplicate tool names within single agent per Principle IV)
- [ ] T024 [US1] Implement AgentFactory validation for spawn constraints (apply defaults: maxCount=100, maxDepth=10)

### 3c: Ollama Provider Adapter

- [ ] T025 [US1] Implement OllamaProvider in src/providers/ollama.ts:
  - authenticate() validates baseUrl + connectivity (fail-fast)
  - translateToolsToLLM() converts Tool[] to Ollama format
  - callLLM() sends prompt + tools to Ollama API (http://localhost:11434)
  - parseResponse() extracts tool call from response
- [ ] T026 [P] [US1] Setup Ollama provider error handling (network errors, invalid models, timeouts → structured errors)
- [ ] T027 [US1] Document Ollama provider constraints (if any; e.g., max tools, response formats)

### 3d: Gemini Provider Adapter

- [ ] T028 [US1] Implement GeminiProvider in src/providers/gemini.ts:
  - authenticate() validates API key (fail-fast)  
  - translateToolsToLLM() converts Tool[] to Gemini function_declarations format
  - callLLM() calls Gemini REST API or SDK
  - parseResponse() extracts tool call from Gemini response
- [ ] T029 [P] [US1] Setup Gemini provider error handling (auth errors, quota exceeded, API deprecations)
- [ ] T030 [US1] Document Gemini provider-specific constraints (cannot mix provider tools + user tools; documented in adapter)

### 3e: Unit Tests for US1

- [ ] T031 [US1] Write unit tests for Agent in tests/unit/agent.test.ts:
  - Test message receive → tool execution → response payload
  - Test tool error handling (tool throws → error in message, not exception)
  - Test tool selection (correct tool called for matching name)
  - Test unknown tool rejection
- [ ] T032 [P] [US1] Write unit tests for AgentFactory in tests/unit/factory.test.ts:
  - Test agent creation with valid config
  - Test fail-fast on invalid credentials
  - Test fail-fast on unreachable provider
  - Test duplicate tool name rejection
  - Test spawn constraint defaults applied
- [ ] T033 [P] [US1] Write unit tests for OllamaProvider in tests/unit/providers/ollama.test.ts
- [ ] T034 [P] [US1] Write unit tests for GeminiProvider in tests/unit/providers/gemini.test.ts

### 3f: Contract Tests for US1 (Principle II)

- [ ] T035 [US1] Write contract test in tests/contract/message.contract.test.ts:
  - Validate all messages conform to contracts/message.schema.json
  - Test message serialization round-trip (JSON → object → JSON)
  - Test error payload structure (name, message, stack, code)
- [ ] T036 [P] [US1] Write provider adapter contract tests in tests/contract/provider.contract.test.ts:
  - Each provider translates tools to format, sends request, parses response correctly
  - Gemini + Ollama both pass same tool set → consistent behavior

### 3g: Acceptance Scenario Tests (US1)

- [ ] T037 [US1] Write acceptance test for scenario 1: Create agent with 1 provider + 1 tool, receive message, verify ready
- [ ] T038 [P] [US1] Write acceptance test for scenario 2: Multi-tool agent, send request for specific tool, verify tool executes
- [ ] T039 [P] [US1] Write acceptance test for scenario 3: Tool throws error, verify error captured in message payload (not thrown)

---

## Phase 4: User Story 2 - Agent Spawning (Dynamic Sub-Agents) (P1)

**Goal**: Parent agent can spawn child agent via spawn_agent tool; send/receive messages to/from child; verify constraints enforced  
**Independent Test**: Parent spawns child, sends message to child, receives response, verifies cascade termination on parent death

### 4a: SpawnAgentTool Implementation

- [ ] T040 [US2] Implement spawn_agent built-in tool in src/spawn/spawn-agent.tool.ts:
  - Tool definition: name='spawn_agent', description, schema from contracts/tool.schema.json example
  - Handler: creates child agent via AgentFactory, returns { sessionId, agentId, status }
  - Validates child config against parent's spawn constraints BEFORE creation
- [ ] T041 [US2] Implement constraint validation in spawn_agent (check maxCount active children, maxDepth calculation, allowedTypes)
- [ ] T042 [US2] Implement spawn rejection with structured errors (e.g., "Cannot spawn: exceeds maxCount=5"; code='SPAWN_LIMIT_EXCEEDED')

### 4b: AgentSession Lifecycle Management

- [ ] T043 [US2] Implement AgentSession class in src/spawn/session-manager.ts:
  - Constructor: takes agent, parentId, currentDepth
  - Properties: sessionId (UUID), agentId, createdAt, terminatedAt, spawnCount, currentDepth
  - Methods: send(message), terminate(), isAlive(), inspect()
- [ ] T044 [US2] Implement message routing in AgentSession (route to agent.receive, maintain session isolation)
- [ ] T045 [US2] Implement cascading termination: parent.terminate() → force terminate all activeChildren
- [ ] T046 [US2] Implement session tracking in Agent: addChild(session), removeChild(sessionId), activeChildren Map

### 4c: spawn_agent Tool Injection

- [ ] T047 [US2] Inject spawn_agent as built-in tool into all agents (in Agent constructor or AgentFactory.build())
- [ ] T048 [US2] Ensure spawn_agent tool inherits parent's spawn constraints (maxCount, maxDepth passed to child)
- [ ] T049 [US2] Implement parent-child session management (parent tracks active children; cleanup on termination)

### 4d: Unit Tests for US2

- [ ] T050 [US2] Write unit tests for spawn_agent tool in tests/unit/spawn-agent.test.ts:
  - Test spawn with valid child config → returns sessionId
  - Test spawn constraint validation (reject if exceeds maxCount, maxDepth)
  - Test spawn rejection with clear error message
- [ ] T051 [P] [US2] Write unit tests for AgentSession in tests/unit/session-manager.test.ts:
  - Test message routing to child agent
  - Test cascading termination
  - Test inspect() state serialization
- [ ] T052 [P] [US2] Write unit tests for spawn constraint tracking in tests/unit/spawn-constraints.test.ts

### 4e: Contract Tests for US2 (Principle II)

- [ ] T053 [US2] Write spawn_agent tool contract test in tests/contract/spawn-agent.contract.test.ts:
  - Validate spawn request schema matches contracts/tool.schema.json spawn_agent example
  - Validate spawn response structure: { sessionId, agentId, status, error? }
  - Test error payload structure on constraint violation

### 4f: Integration Tests for US2

- [ ] T054 [US2] Write integration test for US2 scenario 1: parent spawns child, receives sessionId
- [ ] T055 [P] [US2] Write integration test for US2 scenario 2: parent sends message to child via sessionId, child responds
- [ ] T056 [P] [US2] Write integration test for US2 scenario 3: parent spawns child with restricted tools, child can only see authorized tools
- [ ] T057 [P] [US2] Write integration test for US2 scenario 4: parent terminates, child is cascade-terminated, further messages fail

---

## Phase 5: User Story 3 - Compose Multiple Agents (P2)

**Goal**: Multi-agent workflows (chains, fan-out) execute with ordered message delivery and error propagation  
**Independent Test**: 3-agent chain where A spawns B, B spawns C, C returns result through B to A; constraints enforced

### 5a: Multi-Agent Composition Helpers (Optional Framework Layer)

- [ ] T058 [P] [US3] Create composition helper pattern in src/spawn/composition.ts (documented examples, not framework enforcement):
  - Pattern: Serial chain (agent passes result to next)
  - Pattern: Fan-out (1 agent spawns N children, collects results)
  - Pattern: Hierarchies (multi-level spawn)
- [ ] T059 [P] [US3] Document composition patterns in spec/001-agent-factory/patterns.md (examples for developers)

### 5b: Message Ordering & Delivery Guarantees

- [ ] T060 [US3] Implement message ordering in AgentSession (ensure messages delivered in FIFO order per sender-recipient pair)
- [ ] T061 [P] [US3] Verify message IDs + timestamps support tracing across multi-agent paths
- [ ] T062 [US3] Implement context propagation (trace IDs, correlation IDs flow through message.context)

### 5c: Error Propagation in Multi-Agent Chains

- [ ] T063 [US3] Implement error propagation: child error → parent receives error in response message
- [ ] T064 [P] [US3] Ensure other children remain operable if one fails (isolation per scenario 1)
- [ ] T065 [P] [US3] Implement error stack preservation via context (allow tracing error origin through chain)

### 5d: Integration Tests for US3

- [ ] T066 [US3] Write integration test for 3-agent chain: A → B → C (sequential spawning, result flows back)
- [ ] T067 [P] [US3] Write integration test for fan-out: A spawns 3 children, collects all responses
- [ ] T068 [P] [US3] Write integration test for hierarchical workflow: A spawns B, B spawns 2 children, all complete
- [ ] T069 [P] [US3] Write integration test for error propagation: child fails → parent sees error, siblings continue
- [ ] T070 [P] [US3] Write integration test for spawn constraint enforcement in multi-agent: maxDepth limits nested spawning

### 5e: Acceptance Scenario Tests (US3)

- [ ] T071 [US3] Write acceptance test for US3 scenario 1: Multiple agents in composition, one fails → error propagates, others operable
- [ ] T072 [P] [US3] Write acceptance test for US3 scenario 2: Fan-out (A→3 children), all complete → results collected
- [ ] T073 [P] [US3] Write acceptance test for US3 scenario 3: High message volume → ordering + delivery guaranteed
- [ ] T074 [P] [US3] Write acceptance test for US3 scenario 4: Spawn constraint violation → rejected with error
- [ ] T075 [P] [US3] Write acceptance test for US3 scenario 5: maxDepth exceeded → spawn rejected with error

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, edge runtime verification, performance tuning, release

- [ ] T076 Create CHANGELOG.md starting with v1.0.0 (completed features, breaking changes if any)
- [ ] T077 [P] Write comprehensive README.md with all quickstart examples (Ollama basic, Gemini, chains, error handling, edge runtime)
- [ ] T078 [P] Create API documentation in docs/ (Agent, AgentFactory, Message, Tool, SpawnConstraints, AIProvider base)
- [ ] T079 [P] Create provider adapter documentation in docs/providers/ (Ollama + Gemini setup, constraints, troubleshooting)

### 6a: Edge Runtime Compatibility

- [ ] T080 Verify tsup build produces tree-shakeable ESM for Cloudflare Workers (test import in edge runtime simulator)
- [ ] T081 [P] Test package exports in worker environment (core works; unused providers don't get bundled)
- [ ] T082 [P] Test Ollama provider in Node.js only; Gemini provider works in both Node.js + edge runtime

### 6b: Performance & Observability

- [ ] T083 Profile agent spawn operation (target <100ms p95); optimize if needed
- [ ] T084 [P] Profile message latency (target <50ms p95 for single-machine scenario)
- [ ] T085 [P] Implement tracing hooks for OpenTelemetry integration (optional; documented in docs/observability.md)
- [ ] T086 Verify structured JSON logging works (test JSON parse → console works for machines)

### 6c: Test Coverage & Quality Gates

- [ ] T087 Run full test suite; verify coverage >95% baseline (unit + contract + integration)
- [ ] T088 [P] Verify no console.log() in production code; only structured logging
- [ ] T089 [P] Verify no `any` types except documented escapes with //@ts-ignore comments
- [ ] T090 [P] Verify Biome linting passes; no warnings

### 6d: Release Preparation

- [ ] T091 Verify package.json exports correct (./providers/ollama, ./providers/gemini subpaths work)
- [ ] T092 Create release checklist: docs complete, tests pass, coverage >95%, performance targets met, edge runtime verified
- [ ] T093 Tag release as v1.0.0 in Git; push to npm (dry-run first)

---

## Dependencies & Parallel Execution

### Phase 1 (Setup): All parallelizable
- T001 must complete first (directory structure)
- T002-T007 can run in parallel (TypeScript, tsup, Biome, Vitest, CI setup)
- T008 (README) depends on Phase 3 completion

### Phase 2 (Foundational): All can run in parallel
- Core types (T009-T012) independent
- Providers base (T013) depends on core types
- Logging (T014), serialization (T015) independent
- Contract framework (T016) can start immediately

### Phase 3 (US1): Sequential within story
- T017-T020: Agent runtime (sequence: types → receiver → executor → routing)
- T021-T024: Factory (sequence: factory class → provider resolution → validation)
- T025-T027: Ollama (independent, ~3 tasks)
- T028-T030: Gemini (independent, ~3 tasks); can parallel with Ollama
- T031-T034: Unit tests (can parallel with implementations)
- T035-T039: Contract + acceptance tests (depend on implementations)

**Parallel Opportunities in US1**:
- Ollama + Gemini providers: simultaneous (T025 || T028)
- Unit test files: parallel (T031 || T032 || T033 || T034)

### Phase 4 (US2): Sequential within story
- Spawn tool (T040-T042): must complete before session tests
- AgentSession (T043-T046): can parallel with spawn tool
- Tool injection (T047-T049): depends on spawn tool
- Tests can execute in parallel (T050-T057)

### Phase 5 (US3): Depends on Phase 4 completion
- Composition helpers (T058-T059) can start immediately
- Message ordering (T060-T062): independent
- Error propagation (T063-T065): independent
- Integration tests (T066-T075): can parallel

### Phase 6 (Polish): Parallel; mostly independent
- Documentation (T076-T082): independent
- Performance (T083-T086): can parallel
- Quality gates (T087-T090): can parallel
- Release (T091-T093): sequential at end

---

## Task Summary by Phase

| Phase | Tasks | Duration Estimate | Blocking |
|-------|-------|---|---|
| Phase 1: Setup | T001-T008 | 2-3 days | Blocks all |
| Phase 2: Foundational | T009-T016 | 2-3 days | Blocks US1/US2/US3 |
| Phase 3: US1 | T017-T039 | 4-5 days | **MVP scope** |
| Phase 4: US2 | T040-T075 | 4-5 days | **MVP scope** (depends on US1) |
| Phase 5: US3 | T076-T088 | 3-4 days | High-value (depends on US2) |
| Phase 6: Polish | T089-T093 | 2-3 days | Release-blocking |
| **Total** | **93 tasks** | **~17-23 days** | Sequential phases |

---

## MVP Scope Recommendation

**Minimum Viable Product** (14-15 days):
- Phase 1: Setup ✅
- Phase 2: Foundational ✅  
- Phase 3: US1 ✅ (Single agent + tools; Ollama + Gemini providers)
- Phase 4: US2 ✅ (Spawning + constraints)
- Phase 6 (partial): Documentation + basic README ✅

**Delivers**: Single agent creation, multi-agent spawning, spawn constraints, 2 provider implementations, test coverage >95%

**Optional (later release)**:
- Phase 5: Advanced composition patterns (chains, fan-out)
- Phase 6 (full): Comprehensive docs, performance tuning, edge runtime verification

---

## Task Execution Checklist

Before starting Phase N, ensure:
- [ ] Previous phase 100% complete + tested
- [ ] All phase-blocking dependencies resolved
- [ ] Code review checkpoints in place (per Constitution PR requirement)
- [ ] Test coverage gates enforced (>95% baseline)

---

**Status**: ✅ **Tasks Ready for Implementation**  
**Total Effort**: 93 tasks across 6 phases  
**MVP Timeline**: ~2-3 weeks (Phases 1-4 + partial Phase 6)  
**Full Release**: ~3-4 weeks (all phases)

Proceed to Phase 1 implementation (T001-T008) →
