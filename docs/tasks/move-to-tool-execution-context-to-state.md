## Parent

[docs/plans/extract-completion-orchestration.md](../plans/extract-completion-orchestration.md)

## What to build

Move `toToolExecutionContext()` from `domain/aiProvider/model.ts` to `application/orchestrator/state.ts`. Update `step.ts` to import it from the new location. Clean dead imports from `aiProvider/model.ts`.

`toToolExecutionContext()` constructs `ToolExecutionContext` from `Config` + `State` — a state concern, not an AI concern. The types `ToolContext` and `ToolExecutionContext` already live in `state.ts`.

## Acceptance criteria

- [ ] `toToolExecutionContext()` is defined in `application/orchestrator/state.ts`
- [ ] `step.ts` imports `toToolExecutionContext` from `./state` instead of `@/domain/aiProvider/model`
- [ ] `toToolExecutionContext()` is removed from `domain/aiProvider/model.ts`
- [ ] Dead imports (`ToolExecutionContext`) removed from `domain/aiProvider/model.ts`
- [ ] `src/index.ts` exports are unchanged (no public API change)
- [ ] All existing tests pass

## Blocked by

None - can start immediately.
