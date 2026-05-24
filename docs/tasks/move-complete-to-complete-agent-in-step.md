## Parent

[docs/plans/extract-completion-orchestration.md](../plans/extract-completion-orchestration.md)

## What to build

Move `complete()` from `domain/aiProvider/model.ts` to `application/orchestrator/step.ts`, rename to `completeAgent()`. Update `Agent.handleEvent()` to import and call `completeAgent` from `step.ts`. Remove `complete` from `src/index.ts` exports. Clean remaining dead imports from `aiProvider/model.ts`. Add unit tests for `completeAgent()`.

`complete()` does orchestrator work: provider lookup, tool filtering, AI call, history push, output routing, and event queuing. The AI Provider module's interface should be about AI completion types only.

**Note:** This creates a circular dependency: `step.ts` imports `Agent`, and `Agent` imports `completeAgent` from `step.ts`. Safe with ESM (live bindings, resolved at call time).

## Acceptance criteria

- [x] `completeAgent()` is defined in `application/orchestrator/step.ts` with the full body of the old `complete()` (provider lookup, tool filtering, AI call, history push, output routing, event queuing)
- [x] `Agent.handleEvent()` imports `completeAgent` from `@/application/orchestrator/step` and calls it
- [x] `complete()` is removed from `domain/aiProvider/model.ts`
- [x] Dead imports (`Config`, `State`, `Agent`, `nanoid`, `ToolCallEvent`) removed from `domain/aiProvider/model.ts`
- [x] `complete` is removed from `src/index.ts` exports; `AIProvider`, `HistoryEntry`, `ToolCall`, `CompletionResult`, `ToolCallResult` remain exported
- [x] `domain/aiProvider/model.ts` contains only: `ToolCall`, `ToolCallResult`, `CompletionResult`, `HistoryEntry` types and `AIProvider` interface
- [x] Unit tests for `completeAgent()` cover: provider resolution by template `ai_provider` name, tool filtering by template `allowedTools`, content routed through `outputHandler`, tool calls queued as `ToolCallEvent`s, error when provider not found
- [x] All existing tests pass

## Blocked by

[docs/tasks/move-to-tool-execution-context-to-state.md](move-to-tool-execution-context-to-state.md)
