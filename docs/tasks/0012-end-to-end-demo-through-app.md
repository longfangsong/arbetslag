# 0012 — End-to-end demo through the app

**What to build:** the feature working through a consumer app: the user asks the entry agent something that needs heavy work, the entry agent creates a Sub-agent, waits for its Report, and answers the user — with nothing from the Sub-agent reaching the chat.

**Blocked by:** 0004 (`create_agent` end to end), 0006 (`wait_for_agent` as an open tool call), 0010 (the Sub-agent knows what it is), 0011 (`send_agent_message` for follow-up turns).

- [ ] The sub-agent tools are registered as built-in tools for library consumers.
- [ ] A Template that lists `create_agent` and `wait_for_agent` is provided in the demo app.
- [ ] A scripted run shows: user message → `create_agent` returns an ack → the Sub-agent works in its own history → `wait_for_agent` resolves with its Report → the entry agent replies to the user.
- [ ] The chat shows only the entry agent's reply; the Sub-agent's answer is not routed to the user.
- [ ] The entry agent is a Creator like any other Agent — no special role in the code.

Related: `docs/prd/0003-sub-agent.md`, `docs/adr/0003-wait-as-unresolved-tool-call.md`
