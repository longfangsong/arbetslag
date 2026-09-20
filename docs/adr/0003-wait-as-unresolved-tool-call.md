# Waiting is an unresolved tool call, not a blocked handler

A Creator waits for a Sub-agent's Report, but a tool handler cannot block: `step()` awaits the whole handler before the queue advances, so a tool that waits for another agent's work waits on events that can never be processed. We decided that a Wait is represented as an **open tool call** — the tool returns nothing, and its response is written later, when a Report for the waited-for agent is consumed. `Agent.waitingForToolCallCount > 0` already means "this agent is waiting" and already suppresses the next LLM request, so no new state machine is needed: the Report becomes the tool result.

Rejected alternatives: blocking inside `tool.call` (deadlocks the single-threaded loop); a status-only/polling tool (needs the model to re-call repeatedly and gives no blocking behavior).

## Inbound events to a waiting agent are held

Message and api_callback events arriving for an agent with an open tool call are queued until that tool call resolves. This keeps the Round invariant — an assistant message with tool_calls is never separated from its tool results — and keeps a Wait uninterruptible. The alternative (process immediately) re-prompts the model mid-wait, which is an interruption and puts a user entry between a tool call and its response.

## Reports reach the Creator only through a Wait

A Report (the content of the turn a Sub-agent ends, including an empty one) is read by a `wait_for_agent` call naming that Sub-agent, and a Wait resolves with the **latest** Report for that agent — the same one-request-one-response pairing as any other tool call. A Report is not stored separately: it is the agent's last turn-ending assistant entry in history (`agent/report.ts`), which is already persisted with the agent record. Mid-turn content (an assistant entry with tool calls) is not a Report, so it is never read. Delivery is the decision of the waited-for agent's own output router: an agent has a router, the app's channel for one that speaks to a user, the Report Router for one with a Creator, which answers the open Wait naming that agent (see `CONTEXT.md` Output Router). Routers stay stateless — the Report lives in history — so a router is a routing decision, not a mailbox. Accepted trade-offs: a second Wait for the same agent re-reads the same Report, and a Report whose turn has been compacted away resolves as the compaction summary (which covers several turns, not one). Failure is a Report flagged as failure, not a second channel.

Consequence: the tool call id must be present, and it is the one id — a tool response event carries the id of the call it answers rather than its own, so a call and its response trace as one id. Without it, a late response can decrement `waitingForToolCallCount` without pairing to the entry that is actually waiting.

## Pending state is agent state, not queue state

The event queue is not persisted, so a Wait survives a checkpoint only because the pending tool call is an unanswered tool call in the Creator's persisted history and the Report lives in the Sub-agent's persisted history. This is why the response event cannot be the thing that survives: the pairing must be rebuilt from history on restore. On restore, pending Waits are re-evaluated against the Report before anything else (`Orchestrator.resolveOpenWaits()`). Pending Waits do not create events, so `stepUntilIdle` may return while a Creator is waiting — the program stops and resumes on the next external event, which is the existing serverless model.

Rejected alternative: persisting the whole event queue as part of State. Revisit when unprocessed events must survive a restart for other reasons; then the pending-state fields become redundant.

## Tool capabilities stay narrow

Tools get only what the sub-agent feature needs from the runtime — the ability to create an agent, to push an event, and to read one agent's Report — not the repository set. Revisit when a second tool needs access to something beyond these.

Revision: a `depth` field was removed from the tool execution context — no tool read it, and the orchestrator computed the Creator chain on every tool call for a value nobody used. The agent tree is also something tools cannot reach, but that argues for injecting a **query** (`getLineage(caller)`/`getAgent(id)`) when a tool actually needs one, not a precomputed field: a field pins one answer and is paid for on every call regardless of use, and it would have to grow into `lineage`/`chatId`/`siblings` as questions are asked. Context holds capabilities and per-call values (the tool call id, the event queue); facts about an agent live on the agent record and are reachable through the `caller` argument.
