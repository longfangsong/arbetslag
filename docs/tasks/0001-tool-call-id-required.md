# 0001 — Tool calls pair by id

**What to build:** every tool call carries an id and every tool response is attributed to the exact tool call that made it, so a response arriving later can resolve *that* call — the prerequisite for a tool call that stays open (see `docs/adr/0003-wait-as-unresolved-tool-call.md`). Pure prefactor: no behavior change beyond pairing.

**Blocked by:** None — can start immediately.

- [x] Tool call id is required (not optional) on a tool call and on the tool response event.
- [x] The tool result entry in an Agent's history records the tool call id it answers.
- [x] A response decrements the waiting count only for the call it pairs with.
- [x] Existing tools, providers and tests are migrated in the same change and stay green.

Related: `docs/prd/0003-sub-agent.md`, `docs/adr/0003-wait-as-unresolved-tool-call.md`
