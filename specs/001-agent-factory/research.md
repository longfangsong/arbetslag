# Research: Agent Factory

**Date**: 2026-04-10  
**Status**: Complete (all clarifications resolved in specification phase)  
**Input**: Agent Factory spec + technical requirements from user

## Research Questions

### Q1: Message Transport & Serialization

**Resolved**: JSON serialization for v1 (universal, debuggable). Binary support deferred. Message structure: `{ id, sender, recipient, type, payload, timestamp, context?, error? }` with optional extensibility via context object.

### Q2: Provider Adapter Pattern

**Resolved**: Minimal adapter interface matching AIProvider entity from spec. Each provider handles:
- Authentication (API key storage)
- Model name mapping (user-friendly → provider-specific)
- Request translation (tool list → provider schema)
- Response parsing (raw LLM output → Message payload)

Both Ollama (local) and Gemini (cloud) follow same pattern.

### Q3: Spawn Constraint Propagation

**Resolved**: Child agents declared in spawn call must NOT inherit parent constraints automatically. Parent specifies constraints when creating child. This maintains explicit control (Principle III: Composable without magic).

Example: Parent with maxDepth=5 spawns child with maxDepth=3. Child cannot exceed depth 3 even if parent could go deeper.

### Q4: Tool Execution Error Handling

**Resolved**: Tool handler must wrap execution in try-catch. Errors captured as object: `{ name, message, stack?, code? }`. Returned in Message.error field (not thrown). LLM sees structured error in message; agent can retry.

### Q5: Edge Runtime Compatibility

**Resolved**: 
- **Avoid**: Node.js fs, net, child_process (not available in edge runtimes)
- **Use**: Web APIs (fetch, ReadableStream, AbortController)
- **Pattern**: Provider adapters handle runtime-specific I/O; core framework stays platform-agnostic

Node.js fs usage (if any) optional behind explicit provider/adapter.

## Implementation Notes

1. **TypeScript Configuration**: `tsconfig.json` set to `strict: true`, `module: "esnext"`, `target: "es2020"`
2. **Biome Configuration**: Enable all @typescript-eslint rules except documented escapes
3. **Test Framework**: Vitest for fast ESM-native testing; @vitest/ui for coverage
4. **Package Delivery**: 
   - ESM default (`.js`)
   - CommonJS optional (`.cjs`) via tsup dual-build
   - Edge runtime verified via esbuild target
5. **CI/CD Readiness**: All tests must pass; coverage >95% baseline

## Decisions Locked In

| Decision | Rationale |
|----------|-----------|
| JSON-only serialization (v1) | Debuggable; matches web standards; sufficient for MVP |
| Minimal provider interface | Reduces coupling; each provider independent; easier to add new providers |
| Explicit spawn constraints (no inheritance) | Predictable; aligns with Constitution Principle III (learnable) |
| Structured error payloads | Allows LLM to see error context; enables retry logic |
| Web APIs + optional Node adapters | Edge runtime compatible; core framework stays portable |

---

**Status**: ✅ **Phase 0 Research Complete**  
Proceed to Phase 1 (design + contracts generation) →
