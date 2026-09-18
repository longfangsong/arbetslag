# Compact token metering: last real prompt_tokens + estimation fallback

The compact threshold check needs the size of the *upcoming* LLM request, but no
token count exists before the request is sent. We decided to meter in a hybrid:
when the previous LLM response carried a real `usage.prompt_tokens` (stored as
`Agent.lastPromptTokens`), the next request is metered as **that value plus an
estimate of only the history entries added since** (the real value already
covers the system prompt and the old history). Without a real value (new agent,
provider omitted usage, in-memory provider), the whole history is estimated (the
system prompt lives in history[0], so it is already counted). The estimator
counts CJK characters as 1 token each and all other characters as 1 token per 4
characters — no tokenizer dependency.

After any compaction (rule-level or LLM-level) `lastPromptTokens` is cleared
(`Agent.clearLastPromptTokens()`), and the next check falls back to full
estimation until the next LLM response stores a new value. Rule-level
re-measurement (the check that decides escalation to LLM-level) always uses
full estimation, because the rule pass mutates entries the real value already
covers.

Why this shape: the real value makes the metering exact for everything except
the delta — and the delta is precisely where growth happens between LLM calls
(bulk tool results), so it is estimated with the same cheap formula. Clearing
on compaction prevents a stale value from over-estimating a shrunken history
and re-triggering compaction on the very next request.

Revisit when: a provider we use returns usage for the request *preview* or a
cheap server-side tokenization endpoint appears — then estimation can be
dropped entirely. If estimation proves materially wrong for a model in
production, upgrade the estimator (per-language ratios or a WASM tokenizer)
before touching the metering design.
