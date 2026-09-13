# Compact token metering: provider usage anchor + estimation fallback

The compact threshold check needs the size of the *upcoming* LLM request, but no
token count exists before the request is sent. We decided to meter in a hybrid:
when the previous LLM response carried a real `usage.prompt_tokens`, the next
request is metered as **that anchor plus an estimate of only the history entries
added since** (the anchor already covers the system prompt and the old history).
Without an anchor (new agent, provider omitted usage, in-memory provider), the
whole system prompt + history is estimated. The estimator counts CJK characters
as 1 token each and all other characters as 1 token per 4 characters — no
tokenizer dependency.

After any compaction (rule-level or LLM-level) the anchor is invalidated, and
the next check falls back to full estimation until the next LLM response re-anchors.
Rule-level re-measurement (the check that decides escalation to LLM-level) always
uses full estimation, because the rule pass mutates entries the anchor already
covers.

Why this shape: the anchor makes the metering exact for everything except the
delta — and the delta is precisely where growth happens between LLM calls (bulk
tool results), so it is estimated with the same cheap formula. Invalidating on
compaction prevents a stale anchor from over-estimating a shrunken history and
re-triggering compaction on the very next request.

Revisit when: a provider we use returns usage for the request *preview* or a
cheap server-side tokenization endpoint appears — then estimation can be dropped
entirely. If estimation proves materially wrong for a model in production, upgrade
the estimator (per-language ratios or a WASM tokenizer) before touching the anchor
design.
