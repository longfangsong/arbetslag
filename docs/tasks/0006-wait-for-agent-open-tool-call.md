# 0006 — `wait_for_agent` as an open tool call

**What to build:** the core tracer bullet. `wait_for_agent` names exactly one Agent; its tool call stays open until a Report for that Agent is consumed, and the Report becomes the tool result — one Report per call, oldest first, the same one-request-one-response pairing as any other tool call. The tool handler cannot block, so it yields and the loop keeps draining.

**Blocked by:** 0001 (Tool calls pair by id), 0002 (Tools can push an event), 0005 (Reports are captured and held).

- [ ] While no Report exists for the named Agent, the tool call has no response and the Agent is not re-prompted.
- [ ] Events of the waited-for Agent are still processed while the tool call is open — the queue is not frozen by the wait.
- [ ] When a Report is consumed, it is written as that tool call's result and the Creator is re-prompted when its open tool calls have all responded.
- [ ] A Wait consumes only Reports of the Agent it names; Reports of other Agents are not delivered.
- [ ] Reaching idle with an open wait is allowed — the queue may be empty while a Creator waits.
- [ ] Verified end to end: create a Sub-agent, call `wait_for_agent`, the loop runs the Sub-agent to completion, and the Creator receives its Report as the tool result.

Related: `docs/prd/0003-sub-agent.md` (stories 16–22), `docs/adr/0003-wait-as-unresolved-tool-call.md`
