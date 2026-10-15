# 0004: Agents as concurrent actors

**Status:** accepted. The original decision under this number — an orchestrator pump attaching events to per-chat lanes — was implemented on the `concurrent-lanes` branch and never merged to main. This text is rewritten as the final form of that decision; see "Retired designs".

The orchestrator once processed events strictly one at a time: a slow LLM call in one chat blocked every other chat, even though agents are isolated — each agent's state lives in its own file, and events for chat A never touch chat B's state. Concurrency is required, but one agent's events must stay strictly ordered.

## Decision

An **Agent is an actor**. It owns an **inbox** — the queue of events targeted at it — and drives its own loop: pop the head event, run the dispatch state machine, append the derived events to the tail of the same inbox, checkpoint the agent after each dispatch. Different agents run concurrently; one agent's events run one at a time, in inbox order. The orchestrator never serializes agents — it only routes.

`push(event)` is a synchronous route into the target agent's inbox: user-initiated events (`message`, `compact_request`) target the chat's entry agent, every other event targets the agent named in the event. Because routing is synchronous, two racing messages into a new chat resolve to the same agent: the entry agent is created at routing time (in `push`), not at dispatch time. The default template is resolved once at orchestrator init; a missing default template fails the orchestrator at startup. Unroutable events (unknown agent id, `api_callback` without `to_agent_id`) are dropped with a warning.

The orchestrator owns the **live agent table** — an in-memory map (chat → agent, id → agent) hydrated from the `AgentRepository` at init. The repository is a persistence boundary: hydrate, checkpoint, chat map. `stepUntilIdle` waits until no agent loop is running, then reports the first dispatch error collected since the last call. The host keeps one orchestrator for its lifetime; webhooks push events and return immediately. Single-threaded JavaScript — concurrency is between event dispatches, not between threads.

**Inbox ordering is plain FIFO**: one queue per agent; external pushes and derived events alike append to the tail. A burst of N user messages into an idle agent is answered strictly in turn (`u1, a1, u2, a2, …`); reply k sees only the messages up to k. The retired bus/lanes design let all N user entries land before any completion, so every completion saw the whole burst — that ordering was a byproduct of the global queue, not a rule, and is dropped deliberately. The host's batcher already coalesces bursts explicitly, and in-turn answering is more correct for multi-image batches: reply k now actually sees image k (under the old ordering, `singleImage` demotion could make reply 1 see image 2 but not its own image — see ADR-0003).

## Why per-agent actors, not per-chat lanes

The original design keyed lanes by chat because `message`/`compact_request` mutate — or *create* — the chat's entry agent: before the agent exists there is no agent to key a lane by. Moving creation to routing time removes the exception: a new chat gets its agent inside the route, before any event is dequeued, and the per-agent key is uniform. A chat has exactly one entry agent, so per-agent FIFO still equals the old per-chat FIFO for entry agents; agents without a chat (future sub-agents) are first-class actors instead of needing a fallback lane key.

The loop lives on the agent — `receive(event)` appends and wakes its own loop — not in the orchestrator: the agent owns mailbox, loop, and wake; the orchestrator supplies the per-event handler wrapping the dispatch state machine and the checkpoint. This is the JS form of a channel's "send wakes the receiver" — there is no actor runtime to hide it in.

## Why errors drain

A dispatch error is recorded, and the agent's loop keeps processing; `stepUntilIdle` reports the error to the host, which decides whether to recover or alert. Fail fast per event, drain per system: a single bad event can never wedge an agent's loop, and the orchestrator always ends in a clean, restartable state.

## Consequences

- The inboxes are in-memory. An in-flight (already-popped) event is lost on a crash — same exposure as the retired designs; remaining work is re-driven from the input source after a restart. Persisting inboxes is a separate, larger decision and was not taken.
- There is no global concurrency cap: N active agents make N concurrent LLM calls. If provider rate limits become a problem, the follow-up is a bounded gate on loop start (at most K agent loops running at once).
- A same-tick burst of N messages to one chat makes N LLM calls under both designs; what changes is what each call sees (FIFO paragraph above). One test expectation moves with it: the concurrency suite's "derived events appended" case becomes `u1, a1, u2, a2, u3, a3`.
- The host's `push`/`stepUntilIdle` contract is unchanged; output routers still resolve the destination chat per event; host reads after `stepUntilIdle` stay fresh (every agent is checkpointed when idle).
- `llm_completion_request.history` remains a deprecated live reference to `agent.history` captured at creation; dispatch re-reads the live history.

## Rejected alternatives

- **External-priority inbox** (external pushes jump ahead of queued derived events): kept the retired burst semantics at the cost of a two-segment inbox encoding an ordering we judged an artifact. Revisit if the host stops coalescing bursts and wants burst-visible completions.
- **Orchestrator-driven loop** (the orchestrator loops over each agent's inbox): rejected — the agent owns mailbox, loop, and wake; the state machine stays in the orchestrator as the injected per-event handler.
- **Persistent per-agent consumer** (channel with waiter; each loop runs forever, blocked on receive): rejected — agents are immortal, so a parked promise accumulates per agent for the deployment's lifetime, and idle detection needs busy counters plus queue scans instead of an active-loop set.
- **Lazy agent hydration** (load from disk on first route): deferred — eager hydration keeps routing synchronous and race-free, and per-agent memory is bounded by compaction. Revisit when the agent population makes startup hydration expensive; the upgrade path is lazy load plus a pending slot per agent.

## Retired designs (do not re-litigate)

- **Serial `step()` loop** — one event at a time; a slow LLM blocked every chat. Replaced by concurrent dispatch.
- **Pump + per-chat lanes + global event bus** (the `concurrent-lanes` branch, never merged): promise-chain lanes keyed by chat, derived events re-queued into a global bus. Ordering was a byproduct of the bus; burst coalescing was an accident, not a rule. Replaced by per-agent inboxes.
