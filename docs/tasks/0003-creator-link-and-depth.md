# 0003 — Creator link and depth

**What to build:** an Agent records who created it, so the Sub-agent relationship exists as data (a Sub-agent is an ordinary Agent with a Creator), and depth is known to tools as a field of the tool execution context — computed from the Creator chain, never stored as a value. Chat membership of a Sub-agent is derived from its Creator rather than copied.

**Blocked by:** 0002 (Tools can push an event).

- [ ] An Agent created by another Agent records its Creator, and it survives serialize → deserialize.
- [ ] Depth is computed by walking the Creator chain at tool execution time and exposed as a tool execution context field; no depth value is persisted.
- [ ] A Sub-agent's Chat is resolved through its Creator; nothing stores a second chat reference for it.
- [ ] Agents with no Creator (created by the app) behave exactly as before.

Related: `docs/prd/0003-sub-agent.md` (stories 5–7, 15), `docs/adr/0003-wait-as-unresolved-tool-call.md`
