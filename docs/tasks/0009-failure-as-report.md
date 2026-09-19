# 0009 — Failure reaches the Creator as a Report

**What to build:** a Sub-agent that fails produces a Report flagged as failure on the same channel as its normal Report, so a Creator is never left waiting on an Agent that can no longer answer. This is the explicit exception to the fail-fast policy, which otherwise crashes the processing cycle.

**Blocked by:** 0006 (`wait_for_agent` as an open tool call).

- [ ] An error while processing a Sub-agent's work produces a failure Report for its Creator, consumed by the same `wait_for_agent`.
- [ ] The processing cycle is not crashed by a Sub-agent failure; state is still checkpointed.
- [ ] Fail-fast is unchanged for Agents without a Creator.
- [ ] The Creator's view is uniform: what the Report says, whether it succeeded or failed.

Related: `docs/prd/0003-sub-agent.md` (story 26), `docs/adr/0003-wait-as-unresolved-tool-call.md`
