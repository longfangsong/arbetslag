# 0004: Concurrent chat lanes

Previously the orchestrator processed events strictly one at a time: `step()` popped an event, awaited its dispatch, and only then moved to the next. The Telegram host serialized even harder — a global promise chain processed batches from **all** chats sequentially, and re-queued new batches while the LLM was busy. A slow LLM call in one chat therefore blocked every other chat, even though agents are isolated: each agent's state lives in its own file, and events for chat A never touch the state of chat B.

## Decision

The orchestrator owns a self-driving **pump**: `push(event)` enqueues and starts the pump, and the pump attaches queued events to **per-chat lanes** until the queue is empty. Each lane is a promise chain, so one chat's events dispatch in strict FIFO order while different chats dispatch concurrently. A lane key is the chat an event's effects land in: `message`/`compact_request` use their `chat_id`; every other event resolves through its target agent's chat.

The host keeps **one long-lived orchestrator** for its lifetime: webhook handlers push events and return immediately. `stepUntilIdle` only waits until the queue is empty and no event is in flight, then reports the first dispatch error collected since the last call. The old `step()` is gone — there is no per-event handle for the host to drive.

## Why per-chat, not per-agent

A `message` or `compact_request` mutates — or *creates* — the chat's entry agent. Before the agent exists there is no agent to key a lane by, so agent-keyed lanes would need an exception for exactly those events. Chat-keyed lanes are uniform, and they are still safe: every event that mutates a given agent lands on that agent's chat lane, so one agent's history is always modified in strict FIFO order.

## Why errors drain

A dispatch error is recorded, and the lane keeps processing; the rest of the queue drains, and `stepUntilIdle` reports the error. Fail fast per event, drain per system: a single bad event can never wedge the lanes, and the orchestrator always ends in a clean, restartable state.

## Consequences

- The Telegram host no longer needs a global chain: batches for different chats run concurrently, and a batch that arrives mid-LLM-call queues on the chat lane instead of being re-debounced.
- Tool calls within one LLM turn remain serial (same lane). Parallel tool execution is a larger semantic change and not needed yet.
- There is no global concurrency cap: N concurrent chats make N concurrent LLM calls. If provider rate limits become a problem, a bounded lane scheduler is a follow-up.
- The queue itself is in-memory and not persisted. An in-flight (already-popped) event is lost on a crash — same exposure as the old loop, which also popped before dispatching. Agents themselves are checkpointed to disk after every dispatch.
- Output routers must resolve the destination chat **per event** (the host's `SmartTelegramRouter` looks it up from the producing agent). A router bound to a single chat at construction no longer works.
- `llm_completion_request.history` remains a deprecated live reference to `agent.history` captured at creation; dispatch re-reads the live history.
