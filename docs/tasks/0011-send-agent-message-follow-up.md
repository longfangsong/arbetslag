# 0011 — `send_agent_message` for follow-up turns

**What to build:** a Creator can send a follow-up task to an Agent it created, so work accumulates in that Agent's own context across turns; its next Report is held for the next `wait_for_agent`. Availability is decided by the Template — a Template that does not list the tool has a create-and-report-only Sub-agent.

**Blocked by:** 0004 (`create_agent` end to end), 0006 (`wait_for_agent` as an open tool call).

- [ ] A Creator can send a follow-up message to an Agent it created.
- [ ] Sending to an Agent the caller did not create is not allowed.
- [ ] The follow-up turn produces a new Report; the earlier Reports are not overwritten.
- [ ] Demoable: create, wait, send follow-up, wait again, and the second Report is delivered.

Related: `docs/prd/0003-sub-agent.md` (stories 7–8, 14), `CONTEXT.md` (Sub-agent, Creator)
