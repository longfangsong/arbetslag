## What to build

Refactor `OpenAIProvider` to use a zero-argument constructor. API keys and base URL are read from `process.env` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`) instead of constructor options. The provider's `name` defaults to `"openai"`.

The `OpenAI` client should be created lazily on first `complete()` call so that env vars are read at use time, not construction time.

## Acceptance criteria

- [ ] `OpenAIProvider` has a zero-argument constructor
- [ ] Provider reads `OPENAI_API_KEY` from `process.env`
- [ ] Provider reads `OPENAI_BASE_URL` from `process.env`
- [ ] Provider `name` defaults to `"openai"`
- [ ] `OpenAI` client is created lazily on first `complete()` call
- [ ] Existing tests pass with the new constructor
- [ ] `pnpm type-check` passes

## Blocked by

None - can start immediately.
