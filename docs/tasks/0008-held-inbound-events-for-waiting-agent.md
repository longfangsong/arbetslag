# 0008 — Inbound events are held for a waiting agent

**What to build:** a message or api_callback arriving for an Agent that has an open tool call is queued until that call resolves. This keeps the Round invariant — an assistant message with tool calls is never separated from its tool results — and makes a Wait impossible to interrupt.

**Blocked by:** 0006 (`wait_for_agent` as an open tool call).

- [ ] Inbound events for an Agent with an open tool call are not dispatched immediately; they are processed after that tool call resolves.
- [ ] A Round never contains a user entry between an assistant tool call and its tool result.
- [ ] A new user message does not cancel or resolve a wait.
- [ ] Agents with no open tool call are processed as before.

Related: `docs/prd/0003-sub-agent.md` (story 20), `docs/adr/0003-wait-as-unresolved-tool-call.md`
