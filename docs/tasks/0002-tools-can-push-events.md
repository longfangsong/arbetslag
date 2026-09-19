# 0002 — Tools can push an event

**What to build:** a tool can hand an event to the loop, so a tool's side effect is processed in a later step instead of inside its own call. The seam stays narrow — the tool execution context gains the ability to push an event, and nothing else (no repositories, no provider). The ability to create an Agent is added only in task 0004, when a tool actually needs it.

**Blocked by:** None — can start immediately.

- [x] The tool execution context exposes pushing an event.
- [x] An event pushed by a tool is processed by the loop in a later step, in queue order.
- [x] Existing tools and their tests are unaffected (they do not use the new capability).
- [x] Verified with one test tool that pushes an event and asserts the loop processes it.

Related: `docs/prd/0003-sub-agent.md`, `docs/adr/0003-wait-as-unresolved-tool-call.md`
