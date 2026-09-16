import { Result, ok, err } from "neverthrow";
import { AIProvider } from "@/application/aiProvider/model";
import { Agent } from "./model";
import { ContentPart, HistoryEntry, contentText } from "./history";
import createDebug from "debug";

const log = createDebug("arbetslag:compact");

export const DEFAULT_COMPACT_THRESHOLD = 32768;
export const DEFAULT_COMPACT_RETAIN_ROUNDS = 4;

const OMITTED_PREFIX = "[omitted:";
const MAX_ARG_VALUE_CHARS = 100;

// ── Token estimation (see docs/adr/0001-compact-token-metering.md) ──────────

// ponytail: CJK×1 + others÷4 heuristic, no tokenizer dependency. Upgrade to a
// real tokenizer if this proves materially off for a model in production.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/\p{Script=Han}/gu) ?? []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

// ponytail: images billed as a flat 1024 tokens (OpenAI low-detail price),
// no per-pixel accounting.
const IMAGE_TOKEN_ESTIMATE = 1024;

function countImages(content: string | Array<ContentPart>): number {
	return typeof content === "string" ? 0 : content.filter((p) => p.type === "image").length;
}

export function estimateEntryTokens(entry: HistoryEntry): number {
  if (entry.role === "assistant") {
    return (
      estimateTokens(entry.content) +
      estimateTokens(JSON.stringify(entry.tool_calls ?? {}))
    );
  }
  return estimateTokens(contentText(entry.content)) + countImages(entry.content) * IMAGE_TOKEN_ESTIMATE;
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

function truncateLongStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_ARG_VALUE_CHARS
      ? `${value.slice(0, MAX_ARG_VALUE_CHARS)}…(${value.length - MAX_ARG_VALUE_CHARS} more chars)`
      : value;
  }
  if (Array.isArray(value)) return value.map(truncateLongStrings);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateLongStrings(v);
    }
    return out;
  }
  return value;
}

/**
 * Stubs out bulky tool I/O below the waterline. Idempotent: entries whose
 * content already starts with the `[omitted:` marker are left alone.
 */
export function applyRuleBasedCompaction(
  history: Array<HistoryEntry>,
  waterline: number,
): { history: Array<HistoryEntry>; changed: boolean } {
  // Truncate bulky assistant tool-call arguments first (all history: the stub
  // of a tool entry below the waterline quotes its (now short) arguments).
  const next = history.map((entry) =>
    entry.role === "assistant" && entry.tool_calls
      ? {
          ...entry,
          tool_calls: entry.tool_calls.map((tc) => ({
            ...tc,
            arguments: truncateLongStrings(tc.arguments) as Record<string, any>,
          })),
        }
      : entry,
  );

  const argsById = new Map<string, Record<string, any>>();
  for (const entry of next) {
    if (entry.role === "assistant" && entry.tool_calls) {
      for (const tc of entry.tool_calls) {
        if (tc.id) argsById.set(tc.id, tc.arguments);
      }
    }
  }

  let changed = false;
  const stubbed = next.map((entry, i) => {
    if (i >= waterline || entry.role !== "tool") return entry;
    if (entry.content.startsWith(OMITTED_PREFIX)) return entry;
    const args = entry.tool_call_id ? argsById.get(entry.tool_call_id) : undefined;
    let argsPart = "";
    if (args) {
      let argsJson = JSON.stringify(args);
      if (argsJson.length > MAX_ARG_VALUE_CHARS) {
        argsJson = `${argsJson.slice(0, MAX_ARG_VALUE_CHARS)}…`;
      }
      argsPart = ` args=${argsJson}`;
    }
    changed = true;
    return {
      ...entry,
      content: `${OMITTED_PREFIX}${entry.name}]${argsPart}`,
    };
  });

  return { history: stubbed, changed };
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
          const calls = entry.tool_calls?.length
            ? ` [calls: ${entry.tool_calls
                .map((tc) => `${tc.tool_name}(${JSON.stringify(tc.arguments)})`)
                .join("; ")}]`
            : "";
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

const NOTHING_TO_COMPACT = "📦 Nothing to compact";
export { NOTHING_TO_COMPACT };

function formatTokens(n: number): string {
  return n >= 1000 ? `~${(n / 1000).toFixed(1)}K` : `~${n}`;
}

export function formatCompactNotice(
  beforeTokens: number,
  afterTokens: number,
): string {
  return `📦 Compacted history: ${formatTokens(beforeTokens)} → ${formatTokens(afterTokens)} tokens`;
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
  const systemPrompt = agent.template.systemPrompt;
  const beforeTokens =
    estimateTokens(systemPrompt) + estimateHistoryTokens(agent.history);
  const waterline = findWaterline(agent.history, retainRounds);
  // Snapshot before any mutation so a compaction that ends up larger than it
  // started (e.g. an LLM summary of a tiny segment cost more than it saved)
  // can be rolled back to a clean no-op instead of a half-compacted history.
  const originalHistory = agent.history;

  let compacted = false;
  if (waterline > 0) {
    const { history, changed } = applyRuleBasedCompaction(agent.history, waterline);
    if (changed) {
      agent.history = history;
      compacted = true;
    }
  }

  let afterTokens =
    estimateTokens(systemPrompt) + estimateHistoryTokens(agent.history);
  if (afterTokens >= threshold) {
    // history[0] is the system entry (template systemPrompt plus any previous
    // summary); the summarizable segment always starts at index 1.
    const segment = agent.history.slice(1, waterline);
    if (segment.length > 0) {
      if (!provider) return err("LLM-based compaction needs an AI provider");
      // Rolling summary: the previous summary (if any) lives in history[0]
      // below the "History summary" heading and is re-fed to the summarizer.
      let previousSummary: string | undefined;
      {
        const content = (agent.history[0] as { content: string }).content;
        const marker = "\n## History summary (compacted)\n";
        const idx = content.indexOf(marker);
        if (idx !== -1) {
          const systemPart = content.slice(0, idx).trim();
          previousSummary =
            (systemPart ? systemPart + "\n\n" : "") +
            content.slice(idx + marker.length);
        }
      }
      const completionResult = await provider.complete(
        agent.template.model,
        [
          { role: "system", content: summaryPrompt ?? SUMMARY_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              previousSummary
                ? `A previous summary of older conversation:\n${previousSummary}\n\nSummarize the previous summary together with the new history below.`
                : undefined,
              serializeHistoryForSummary(segment),
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        [],
      );
      if (completionResult.isErr()) return err(completionResult.error);
      const summary = completionResult.value.content.trim();
      if (!summary) return err("Compaction summary came back empty");
      const retained = agent.history.slice(waterline);
      agent.history = [
        {
          role: "system",
          content: `${systemPrompt}\n## History summary (compacted)\n${summary}`,
        },
        ...retained,
      ];
      afterTokens =
        estimateTokens(systemPrompt) + estimateHistoryTokens(agent.history);
      compacted = true;
    } else {
      // Only the retained rounds exist and they alone exceed the threshold:
      // rule-based compaction of the retained rounds themselves (stub their
      // tool I/O) as a last resort before accepting overflow.
      const { history, changed } = applyRuleBasedCompaction(
        agent.history,
        agent.history.length,
      );
      if (changed) {
        agent.history = history;
        compacted = true;
        afterTokens =
          estimateTokens(systemPrompt) + estimateHistoryTokens(agent.history);
      } else {
        // No tool I/O to stub and the retained rounds still exceed the
        // threshold — accepting overflow.
        log(
          `⚠️ agent ${agent.id}: retained rounds alone exceed threshold (${afterTokens} >= ${threshold}) — accepting overflow`,
        );
      }
    }
  }

  // ponytail: if the whole attempt left history no smaller than it started —
  // the summarizer of a small segment cost more than it saved — abandon it:
  // restore the pre-compaction history and report un-compacted, so the caller
  // sends no notice (and the anchor stays valid for the unchanged history).
  if (afterTokens >= beforeTokens) {
    agent.history = originalHistory;
    compacted = false;
    afterTokens = beforeTokens;
  }

  if (compacted) agent.invalidateAnchor();
  return ok({ compacted, beforeTokens, afterTokens });
}
