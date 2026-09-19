# 0010 — The Sub-agent knows what it is

**What to build:** the meta system prompt tells an Agent that ending its turn delivers its Report to its Creator, and who that Creator is. Without this, models try to message the user or call a report tool that does not exist — the Report channel is automatic, so the model's understanding of "end of turn" is part of the behavior.

**Blocked by:** 0005 (Reports are captured and held).

- [ ] The meta prompt states that a Sub-agent's end-of-turn answer is delivered to its Creator, not to the user.
- [ ] An Agent with a Creator is told who its Creator is; an Agent without one is not.
- [ ] The meta prompt survives compaction (same single composition point as today).
- [ ] Agents created before this change are fixed on load, as the existing backfill does.

Related: `docs/prd/0003-sub-agent.md` (stories 10–15), `CONTEXT.md` (Report, Wait)
