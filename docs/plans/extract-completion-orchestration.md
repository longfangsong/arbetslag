# Plan: Extract Completion Orchestration from AI Provider Module

## Problem

`complete()` and `toToolExecutionContext()` live in `domain/aiProvider/model.ts` but do orchestrator work: provider lookup, tool filtering, output routing, event queuing, and state extraction. The AI Provider module's **interface** should be about AI completion types — not orchestration logic.

## Goal

Move orchestration logic into `application/orchestrator/step.ts`. Leave `aiProvider/model.ts` with only the `AIProvider` interface and type definitions.

## Changes

### 1. Move `complete()` → `completeAgent()` in `step.ts`

- Rename to `completeAgent` to distinguish from `AIProvider.complete()`
- Move the full body (provider lookup, tool filtering, AI call, history push, output routing, event queuing)
- Export from `step.ts` so `Agent.handleEvent()` can import it

### 2. Move `toToolExecutionContext()` to `state.ts`

- It constructs `ToolExecutionContext` from `Config` + `State` — a state concern, not an AI concern
- `ToolContext`/`ToolExecutionContext` types already live in `state.ts`

### 3. Update `Agent.handleEvent()` imports

- Replace `import { complete } from "../aiProvider/model"` with `import { completeAgent } from "@/application/orchestrator/step"`
- Replace `return complete(config, state, this)` with `return completeAgent(config, state, this)`

**Note:** This creates a circular dependency between `step.ts` → `Agent` → `completeAgent` in `step.ts`. Safe with ESM (live bindings, resolved at call time), but worth noting.

### 4. Clean `aiProvider/model.ts`

Remove:
- `complete()` function
- `toToolExecutionContext()` function
- Imports: `Config`, `State`, `ToolExecutionContext`, `Agent`, `nanoid`, `ToolCallEvent`

Keep:
- `ToolCall`, `ToolCallResult`, `CompletionResult`, `HistoryEntry` types
- `AIProvider` interface

### 5. Update `src/index.ts`

- Remove `complete` from exports (it was the orchestration function, not part of the AI Provider **interface**)
- Keep `AIProvider`, `HistoryEntry`, `ToolCall`, `CompletionResult`, `ToolCallResult` exports

### 6. Update tests

- `step.test.ts`: indirect tests of `complete()` via `step()` continue to work (behavior unchanged)
- Add direct tests for `completeAgent()` covering:
  - Provider resolution by template `ai_provider` name
  - Tool filtering by template `allowedTools`
  - Content routed through `outputHandler`
  - Tool calls queued as `ToolCallEvent`s
  - Error when provider not found

## Files Changed

| File | Change |
|------|--------|
| `src/domain/aiProvider/model.ts` | Remove `complete()`, `toToolExecutionContext()`, unused imports |
| `src/application/orchestrator/step.ts` | Add `completeAgent()`, import `toToolExecutionContext` from state |
| `src/application/orchestrator/state.ts` | Add `toToolExecutionContext()` |
| `src/domain/agent/model.ts` | Import `completeAgent` from step, call it in `handleEvent()` |
| `src/index.ts` | Remove `complete` export |
| `src/application/orchestrator/step.test.ts` | Add `completeAgent` unit tests |

## Risk

Circular dependency: `step.ts` imports `Agent`, `Agent` imports `completeAgent` from `step.ts`. ESM handles this at runtime, but TypeScript may need no changes (imports are type-level or runtime function calls inside methods).
