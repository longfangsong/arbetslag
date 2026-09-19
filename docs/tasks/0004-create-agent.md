# 0004 — `create_agent` end to end

**What to build:** a Creator can create a Sub-agent from a pre-declared Template and hand it a task, and the call returns immediately with an acknowledgement — the work happens later. This is the first tracer bullet of the feature: create, ack, task delivered as the Sub-agent's first message.

**Blocked by:** 0002 (Tools can push an event), 0003 (Creator link and depth).

- [ ] `create_agent` takes a Template and the task, and returns an ack without waiting for any result.
- [ ] The task is the Sub-agent's first message, so it is a Round boundary for compaction.
- [ ] Creating past the global maximum depth of 3 returns an error to the Creator.
- [ ] The tool is available only to Templates that list it; dispatch does not re-enforce.
- [ ] Demoable: an entry agent creates a Sub-agent, the Sub-agent does one tool call, and the loop continues to drain while the Creator is not waiting.

Related: `docs/prd/0003-sub-agent.md` (stories 1–4, 9, 23–25), `docs/adr/0003-wait-as-unresolved-tool-call.md`
