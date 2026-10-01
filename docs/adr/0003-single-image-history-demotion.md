# 0003: Single-image history demotion

Some endpoints reject a request when the **whole outgoing message history** holds more than one image part in total — not just the new user message. Splitting a multi-image burst into multiple messages (app side) is therefore not enough: every request replays the history, so images from earlier turns keep being sent and get rejected again.

## Decision

A template-level `singleImage` flag. When set, the agent demotes every image part already in the history to a text marker `[Image]` every time a message **with** image parts arrives — before the new entry is pushed (`Agent.handleMessage`). The arriving message's own image parts are untouched, so the model still sees the new image. Text-only messages never trigger demotion, so the single most recent image survives across follow-up text turns.

## Why in the agent

History is owned by the agent and the flag lives on its template; `handleMessage` is the single choke point where user content enters history. The marker is plain text, so it survives serialization and both compaction levels (rule-level never touches user text; LLM-level reads it as ordinary text).

## Consequences

- Once demoted, an image's bytes are permanently lost from the persisted history. That is intentional: it keeps every outgoing request endpoint-compatible and small, at the cost of being able to revisit old images in later turns (the model sees `[Image]` there instead).
- The guarantee is "≤1 image per request" only when each arriving message itself carries ≤1 image (the Telegram app ensures this by splitting multi-image batches into separate messages). A message with 2+ images would still be sent as-is.
