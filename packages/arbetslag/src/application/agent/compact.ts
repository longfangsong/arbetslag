import { Result, ok, err } from "neverthrow";
import { AIProvider } from "@/application/aiProvider/model";
import { Agent, composeSystemPrompt } from "./model";
import {
  AssistantEntry,
  HistoryEntry,
  countImages,
  contentText,
  hasToolCalls,
  text,
} from "./history";

export const DEFAULT_COMPACT_THRESHOLD = 32768;
export const DEFAULT_COMPACT_RETAIN_ROUNDS = 4;

const OMITTED_STUB = "[omitted]";
const MAX_ARG_VALUE_CHARS = 100; // cap for truncated argument values
// Shared by the system-entry writer (compactAgent) and reader
// (extractPreviousSummary); the leading newline is part of the match.
export const SUMMARY_MARKER = "\n## History summary (compacted)\n";

// ── Token estimation (see docs/adr/0001-compact-token-metering.md) ──────────

// CJK×1 + others÷4 heuristic, no tokenizer dependency. Upgrade to a
// real tokenizer if this proves materially off for a model in production.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/\p{Script=Han}/gu) ?? []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

// images billed as a flat 1024 tokens (OpenAI low-detail price),
// no per-pixel accounting.
const IMAGE_TOKEN_ESTIMATE = 1024;

export function estimateEntryTokens(entry: HistoryEntry): number {
  switch (entry.role) {
    case "system":
    case "user":
      return (
        estimateTokens(contentText(entry.content)) +
        countImages(entry.content) * IMAGE_TOKEN_ESTIMATE
      );
    case "tool":
      return estimateTokens(entry.content);
    case "assistant":
      return (
        estimateTokens(entry.content) +
        estimateTokens(JSON.stringify(entry.tool_calls ?? {}))
      );
  }
}

export function estimateHistoryTokens(history: Array<HistoryEntry>): number {
  return history.reduce((sum, entry) => sum + estimateEntryTokens(entry), 0);
}

// ── Rounds and waterline ────────────────────────────────────────────────────

/**
 * Index of the first entry of the last `retainRounds` rounds, or 0 if the
 * whole history fits in the retained rounds. A round starts at a user entry,
 * so the waterline never splits an assistant(tool_calls) entry from its
 * tool results.
 */
export function findWaterline(
  history: Array<HistoryEntry>,
  retainRounds: number,
): number {
  const roundStarts: number[] = [];
  history.forEach((entry, i) => {
    if (entry.role === "user") roundStarts.push(i);
  });
  if (roundStarts.length <= retainRounds) return 0;
  return roundStarts[roundStarts.length - retainRounds];
}

// ── Rule-based compaction ───────────────────────────────────────────────────

/**
 * Recursively truncate long string values. Identity-preserving: values with
 * nothing to truncate come back as the same reference, so callers can detect
 * "actually changed" by reference comparison.
 */
function truncateLongStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_ARG_VALUE_CHARS
      ? `${value.slice(0, MAX_ARG_VALUE_CHARS)}…(${value.length - MAX_ARG_VALUE_CHARS} more chars)`
      : value;
  }
  if (Array.isArray(value)) {
    const out = value.map(truncateLongStrings);
    return out.every((v, i) => v === value[i]) ? value : out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nv = truncateLongStrings(v);
      out[k] = nv;
      if (nv !== v) changed = true;
    }
    return changed ? out : value;
  }
  return value;
}

function truncateToolCalls(entry: AssistantEntry): AssistantEntry {
  let changed = false;
  const tool_calls = (entry.tool_calls ?? []).map((tc) => {
    const shortArgs = truncateLongStrings(tc.arguments) as Record<string, any>;
    if (shortArgs !== tc.arguments) {
      changed = true;
      return { ...tc, arguments: shortArgs };
    }
    return tc;
  });
  return changed ? { ...entry, tool_calls } : entry;
}

/**
 * Compacts one entry in place of the scan, but only below the waterline:
 * tool entries whose content is bulkier than the stub are replaced by it (the
 * tool name stays in the entry's `name` field, which the provider and summary
 * serializer read directly; the call's arguments remain in the assistant
 * entry just above), and assistant entries get their bulky tool-call
 * arguments truncated. Retained rounds (at or above the waterline) come back
 * untouched. A stub never grows the content it replaces, so already-stubbed
 * entries are left alone.
 * Identity-preserving: an entry that needs nothing comes back as the same
 * reference.
 */
function compactOneEntry(
  entry: HistoryEntry,
  underWaterline: boolean,
): HistoryEntry {
  if (!underWaterline) return entry;
  if (hasToolCalls(entry)) return truncateToolCalls(entry);
  if (entry.role === "tool" && entry.content.length > OMITTED_STUB.length) {
    return { ...entry, content: OMITTED_STUB };
  }
  return entry;
}

/**
 * Rule-based compaction in one pass. Idempotent: a stub is never longer than
 * the content it replaces, so a second run finds nothing left to compact.
 */
export function applyRuleBasedCompaction(
  history: Array<HistoryEntry>,
  waterline: number,
): { history: Array<HistoryEntry>; changed: boolean } {
  const compacted = history.map((entry, i) =>
    compactOneEntry(entry, i < waterline),
  );
  // Compacted entries get fresh objects, unchanged ones keep their
  // references, so any reference difference means the history changed.
  const changed = compacted.some((entry, i) => entry !== history[i]);
  return { history: compacted, changed };
}

// ── LLM-based compaction ────────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are compacting the history of an ongoing AI agent conversation.
The input is that history, oldest first. Entries marked [tool ...] had their bulky tool input/output already omitted; the stubs tell you which tool ran.
Write a concise summary that lets the agent continue seamlessly:
- Preserve: user requests and stated preferences, key decisions and their rationale, important facts about files and external resources (paths, URLs, ids, values), the current state of unfinished work, and any commitments the agent made.
- Discard: step-by-step process, redundant phrasing, verbatim quotes, and unimportant tool calls.
- Write in the same language as the conversation. Use short sections. Be as brief as the preserved facts allow.`;

export function serializeHistoryForSummary(
  history: Array<HistoryEntry>,
): string {
  return history
    .map((entry) => {
      switch (entry.role) {
        case "system":
          return `[summary] ${contentText(entry.content)}`;
        case "user": {
          const images = countImages(entry.content);
          return `[user] ${contentText(entry.content)}${images ? ` [${images} image(s)]` : ""}`;
        }
        case "tool":
          return `[tool ${entry.name}] ${entry.content}`;
        case "assistant": {
          let calls = "";
          if (entry.tool_calls?.length) {
            const toolCallInfo = entry.tool_calls
              .map((tc) => `${tc.tool_name}(${JSON.stringify(tc.arguments)})`)
              .join("; ");
            calls = ` [calls: ${toolCallInfo}]`;
          }
          return `[assistant] ${entry.content}${calls}`;
        }
      }
    })
    .join("\n");
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export interface CompactResult {
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
}

export interface CompactDeps {
  agent: Agent;
  provider: AIProvider | null;
  threshold: number;
  retainRounds: number;
  /** Per-template override for the summary prompt (falls back to the built-in). */
  summaryPrompt?: string;
}

/**
 * The previous rolling summary carried in the system entry: the text below
 * the SUMMARY_MARKER (the composed system prompt above it is not part of the
 * summary). Undefined when there is no previous summary.
 */
function extractPreviousSummary(systemEntry: HistoryEntry): string | undefined {
  const content =
    systemEntry.role === "tool" || systemEntry.role === "assistant"
      ? systemEntry.content
      : contentText(systemEntry.content);
  const idx = content.indexOf(SUMMARY_MARKER);
  return idx === -1 ? undefined : content.slice(idx + SUMMARY_MARKER.length);
}

/**
 * Ask the LLM to roll the aged entries (below the waterline) into a summary
 * (plus the previous summary, when one exists). Returns the summary text.
 */
async function llmSummarize(
  provider: AIProvider,
  model: string,
  summaryPrompt: string | undefined,
  previousSummary: string | undefined,
  agedEntries: Array<HistoryEntry>,
): Promise<Result<string, string>> {
  let toSummarize = "";
  if (previousSummary) {
    toSummarize += `# A previous summary of older conversation\n${previousSummary}\n\n`;
  }
  toSummarize += `# New conversation history is to be summarized\n`;
  toSummarize += serializeHistoryForSummary(agedEntries);
  const completionResult = await provider.complete(
    model,
    [
      { role: "system", content: text(summaryPrompt ?? SUMMARY_SYSTEM_PROMPT) },
      {
        role: "user",
        content: text(toSummarize),
      },
    ],
    [],
  );
  if (completionResult.isErr()) return err(completionResult.error);
  const summary = completionResult.value.content.trim();
  if (!summary) return err("Compaction summary came back empty");
  return ok(summary);
}

/**
 * Run the compact pipeline on an agent's history: rule-based first, escalate
 * to LLM-based if the result still meets the threshold. Mutates agent.history
 * and persists nothing (the caller saves the agent).
 */
export async function compactAgent({
  agent,
  provider,
  threshold,
  retainRounds,
  summaryPrompt,
}: CompactDeps): Promise<Result<CompactResult, string>> {
  const systemPrompt = composeSystemPrompt(agent.template);
  // We will keep using rule based token estimation here
  // because in the following rule based compaction we will try to
  // reduce the number of tokens without actually calling the LLM.
  // And there is no way to know how many tokes are there
  // after the rule based compaction. But we have to know whether we have
  // really reduced the number of tokens or not.
  const beforeTokens = estimateHistoryTokens(agent.history);
  const waterline = findWaterline(agent.history, retainRounds);

  let compacted = false;
  // Rule-based compaction only ever shortens entries (stubs replace longer
  // content, argument truncations shorten strings), so a changed history is
  // guaranteed smaller — no size check needed.
  const { history, changed } = applyRuleBasedCompaction(agent.history, waterline);
  if (changed) {
    agent.history = history;
    compacted = true;
  }

  let afterTokens = estimateHistoryTokens(agent.history);
  if (afterTokens >= threshold) {
    // history[0] is the system entry (composed system prompt plus any
    // previous summary); the aged entries to be summarized always start at index 1.
    const agedEntries = agent.history.slice(1, waterline);
    if (agedEntries.length > 0) {
      if (!provider) return err("LLM-based compaction needs an AI provider");
      const summaryResult = await llmSummarize(
        provider,
        agent.template.model,
        summaryPrompt,
        extractPreviousSummary(agent.history[0]),
        agedEntries,
      );
      if (summaryResult.isErr()) return err(summaryResult.error);
      const retained = agent.history.slice(waterline);
      const candidate: Array<HistoryEntry> = [
        {
          role: "system",
          content: text(`${systemPrompt}${SUMMARY_MARKER}${summaryResult.value}`),
        },
        ...retained,
      ];
      const candidateTokens = estimateHistoryTokens(candidate);
      if (candidateTokens < afterTokens) {
        agent.history = candidate;
        afterTokens = candidateTokens;
        compacted = true;
      }
    } else {
      // Only the retained rounds exist and they alone exceed the threshold:
      // rule-based compaction of the retained rounds themselves (stub their
      // tool I/O) as a last resort before accepting overflow.
      const { history: lastResort, changed: lastResortChanged } =
        applyRuleBasedCompaction(agent.history, agent.history.length);
      if (lastResortChanged) {
        agent.history = lastResort;
        compacted = true;
        afterTokens = estimateHistoryTokens(agent.history);
      } else {
        // No tool I/O to stub and the retained rounds still exceed the
        // threshold — accepting overflow.
        console.warn(
          `[compact] agent ${agent.id}: retained rounds alone exceed threshold (${afterTokens} >= ${threshold}) — accepting overflow`,
        );
      }
    }
  }

  if (compacted) agent.clearLastPromptTokens();
  return ok({ compacted, beforeTokens, afterTokens });
}
