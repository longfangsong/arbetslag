# 0007 — A pending Wait survives checkpoint and restart

**What to build:** a Creator that is waiting can be stopped and restored. The event queue is not persisted, so the open tool call and the held Reports live as agent state, and a report that arrived while the program was down is not stranded.

**Blocked by:** 0006 (`wait_for_agent` as an open tool call).

- [ ] The open tool call of a waiting Creator is recorded on the Creator's persisted record.
- [ ] Held Reports survive serialize → deserialize.
- [ ] On restore, open waits are re-evaluated against held Reports before any other processing, and a wait that can be resolved is resolved immediately.
- [ ] Demoable: stop a run mid-wait, restart, and the Creator receives the Report that arrived during the downtime.

Related: `docs/prd/0003-sub-agent.md` (story 19), `docs/adr/0003-wait-as-unresolved-tool-call.md`
