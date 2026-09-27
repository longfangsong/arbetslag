import { err, ok, type Result } from "neverthrow";
import type z from "zod";
import { estimateHistoryTokens } from "@/application/agent/compact";
import {
  contentText,
  type CompletionResult,
  type HistoryEntry,
} from "@/application/agent/history";
import type { Tool } from "@/application/tool/model";
import type { AIProvider } from "@/application/aiProvider/model";

/**
 * What one rule says. `tool_calls` carries no id: FakeLLM assigns `call1`,
 * `call2`… so snapshots stay stable without the rule repeating ids.
 */
export interface Behavior {
  content?: string;
  tool_calls?: Array<{
    tool_name: string;
    arguments?: Record<string, unknown>;
  }>;
  usage?: { prompt_tokens: number };
}

/** One call as the harness saw it — the observation point for assertions. */
export interface LLMRequest {
  model: string;
  history: Array<HistoryEntry>;
  tools: Array<string>;
  outputSchema?: z.ZodType;
  /** text the rule matched against (last user entry, images as `[1 image(s)]`) */
  matchText: string;
}

export type BehaviorRule = Behavior | ((req: LLMRequest) => Behavior);

/**
 * Scripted AI provider: `Map<regex, behaviour>`, tried in insertion order,
 * first match wins.
 *
 * A rule value may be an array — consumed one entry per call on that rule —
 * so one round can say "call the tool" and then "answer". A rule is only
 * advanced when it matches, so unrelated rounds don't consume it.
 *
 * It does not think: the behaviour is fixed text. All interesting behaviour in
 * an e2e test must come from the real components (orchestrator dispatch, agent
 * queue ordering, compaction), not from this fake.
 */
export class FakeLLM implements AIProvider {
  readonly name = "fake";
  readonly requests: Array<LLMRequest> = [];

  private readonly rules: Map<RegExp, Array<BehaviorRule>> = new Map();
  private readonly consumed: Map<RegExp, number> = new Map();
  private toolCallCounter = 0;

  constructor(rules: Map<RegExp, BehaviorRule | Array<BehaviorRule>>) {
    for (const [pattern, behavior] of rules) {
      this.rules.set(pattern, Array.isArray(behavior) ? behavior : [behavior]);
    }
  }

  async complete(
    model: string,
    history: Array<HistoryEntry>,
    allowedTools: Array<Tool<unknown, unknown, unknown>>,
    outputSchema?: z.ZodType,
  ): Promise<Result<CompletionResult, string>> {
    const request: LLMRequest = {
      model,
      history,
      tools: allowedTools.map((t) => t.name),
      outputSchema,
      matchText: matchTextOf(history),
    };
    this.requests.push(request);

    const pattern = this.findRule(request.matchText);
    if (!pattern) {
      return err(
        `FakeLLM: no rule matches ${JSON.stringify(request.matchText)}`,
      );
    }
    const queue = this.rules.get(pattern)!;
    const used = this.consumed.get(pattern) ?? 0;
    if (used >= queue.length) {
      return err(`FakeLLM: rule ${pattern} exhausted at call ${used + 1}`);
    }
    this.consumed.set(pattern, used + 1);

    const rule = queue[used];
    const behavior = typeof rule === "function" ? rule(request) : rule;
    const toolCalls = behavior.tool_calls?.map((tc) => ({
      id: `call${(this.toolCallCounter += 1)}`,
      tool_name: tc.tool_name,
      arguments: tc.arguments ?? {},
    }));

    return ok({
      role: "assistant",
      content: behavior.content ?? "",
      tool_calls: toolCalls,
      // Keep the ADR-0001 metering path alive: a fake with no usage would
      // never trigger compaction the way production does.
      usage: behavior.usage ?? { prompt_tokens: estimateHistoryTokens(history) },
    });
  }

  private findRule(text: string): RegExp | undefined {
    for (const pattern of this.rules.keys()) {
      pattern.lastIndex = 0; // rules should not use /g; guard anyway
      if (pattern.test(text)) return pattern;
    }
    return undefined;
  }
}

/** The last user entry's text, with an `[N image(s)]` marker so image-only rounds are matchable. */
function matchTextOf(history: Array<HistoryEntry>): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.role !== "user") continue;
    const images = entry.content.filter((p) => p.type === "image").length;
    return contentText(entry.content) + (images ? ` [${images} image(s)]` : "");
  }
  return "";
}
