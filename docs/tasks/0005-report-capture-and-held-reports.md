# 0005 — Reports are captured and held

**What to build:** when a Sub-agent ends a turn, its content becomes a Report for its Creator and is stored until the Creator consumes it. A Sub-agent never speaks to the user, so its final answer stops being routed to the output handler.

**Blocked by:** 0003 (Creator link and depth).

- [ ] Ending a turn produces one Report for an Agent that has a Creator — including an empty-content turn, which produces an empty Report.
- [ ] Content produced mid-turn (alongside tool calls) is not a Report.
- [ ] Reports for one Agent accumulate oldest-first, one per turn, and are stored as that Agent's state (persisted).
- [ ] An Agent with a Creator is not routed through the output handler; a user-facing agent still is.
- [ ] Demoable without any wait tool: run a Sub-agent to completion and observe the stored Report.

Related: `docs/prd/0003-sub-agent.md` (stories 10–15), `docs/adr/0003-wait-as-unresolved-tool-call.md`
