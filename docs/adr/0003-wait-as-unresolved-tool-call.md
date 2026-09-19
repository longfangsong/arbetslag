# Waiting is an unresolved tool call, not a blocked handler

A Creator waits for a Sub-agent's Report, but a tool handler cannot block: `step()` awaits the whole handler before the queue advances, so a tool that waits for another agent's work waits on events that can never be processed. We decided that a Wait is represented as an **open tool call** — the tool returns nothing, and its response is written later, when a Report for the waited-for agent is consumed. `Agent.waitingForToolCallCount > 0` already means "this agent is waiting" and already suppresses the next LLM request, so no new state machine is needed: the Report becomes the tool result.

Rejected alternatives: blocking inside `tool.call` (deadlocks the single-threaded loop); a status-only/polling tool (needs the model to re-call repeatedly and gives no blocking behavior); a Wait that reads history (needs a guard so the message handler does not fire an LLM request while a tool call is open, and bookkeeping in two places).

## Inbound events to a waiting agent are held

Message and api_callback events arriving for an agent with an open tool call are queued until that tool call resolves. This keeps the Round invariant — an assistant message with tool_calls is never separated from its tool results — and keeps a Wait uninterruptible. The alternative (process immediately) re-prompts the model mid-wait, which is an interruption and puts a user entry between a tool call and its response.

## Reports reach the Creator only through a Wait

A Report (the content of the turn a Sub-agent ends, including an empty one) is consumed by a `wait_for_agent` call naming that Sub-agent, one Report per call — the same one-request-one-response pairing as any other tool call. A Report that arrives while no Wait is open is held per Sub-agent until a Wait consumes it. Failure is a Report flagged as failure, not a second channel.

Consequence: the tool call id must be present, and it is the one id — a tool response event carries the id of the call it answers rather than its own, so a call and its response trace as one id. Without it, a late response can decrement `waitingForToolCallCount` without pairing to the entry that is actually waiting.

## Pending state is agent state, not queue state

The event queue is not persisted, so a Wait survives a checkpoint only because the pending tool call and the held Reports are stored on the agent records. On restore, pending Waits are re-evaluated against held Reports before anything else. Pending Waits do not create events, so `stepUntilIdle` may return while a Creator is waiting — the program stops and resumes on the next external event, which is the existing serverless model.

Rejected alternative: persisting the whole event queue as part of State. Revisit when unprocessed events must survive a restart for other reasons; then the pending-state fields become redundant.

## Tool capabilities stay narrow

Tools get only what the sub-agent feature needs from the runtime — the ability to create an agent and to push an event — not the repository set. Depth is provided as a field of the tool execution context, computed from the creator chain rather than stored on the agent. Revisit when a second tool needs access to something beyond these.
