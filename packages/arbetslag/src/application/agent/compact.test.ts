import { describe, it, expect, vi } from "vitest";
import { ok, Result } from "neverthrow";

// Unwrap a Result; the test setups are valid, so a failure here is a real bug.
function unwrap<T>(r: Result<T, string>): T {
  return r.match((v) => v, (e) => {
    throw new Error(e);
  });
}
import {
  estimateTokens,
  findWaterline,
  applyRuleBasedCompaction,
  serializeHistoryForSummary,
  compactAgent,
} from "./compact";
import { Agent } from "./model";
import type { Template } from "./template/model";
import { text, contentText } from "./history";
import type { HistoryEntry, CompletionResult } from "./history";
import type { AIProvider } from "@/application/aiProvider/model";

const template: Template = {
  name: "t",
  description: "",
  ai_provider: "openai",
  model: "gpt-4",
  systemPrompt: "sys",
  allowedTools: [],
};

function makeProvider(
  responses: Array<Partial<CompletionResult>>,
  failOnCall?: () => void,
) {
  const calls: Array<{ model: string; history: Array<HistoryEntry> }> = [];
  let i = 0;
  const provider: AIProvider = {
    name: "openai",
    async complete(model, history) {
      calls.push({ model, history });
      if (failOnCall) failOnCall();
      const r = responses[Math.min(i++, responses.length - 1)] ?? {};
      return ok({
        role: "assistant",
        content: r.content ?? "",
        tool_calls: r.tool_calls,
      });
    },
  };
  return { provider, calls };
}

/** user + (optional tool call with long result) + assistant reply */
function makeRound(n: number, toolResultLength = 0): Array<HistoryEntry> {
  const entries: Array<HistoryEntry> = [
    { role: "user", content: text(`user message ${n}`) },
  ];
  if (toolResultLength > 0) {
    entries.push({
      role: "assistant",
      content: "",
      tool_calls: [
        { id: `tc-${n}`, tool_name: "read_file", arguments: { path: "a.txt" } },
      ],
    });
    entries.push({
      role: "tool",
      tool_call_id: `tc-${n}`,
      name: "read_file",
      content: "x".repeat(toolResultLength),
    });
  }
  entries.push({ role: "assistant", content: `assistant reply ${n}` });
  return entries;
}

describe("estimateTokens", () => {
  it("counts CJK chars as 1 token and others as 1 per 4 chars", () => {
    expect(estimateTokens("你好世界")).toBe(4);
    expect(estimateTokens("hello world!!!")).toBe(4); // 14 chars
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hi你好")).toBe(3); // 2 + ceil(2/4)
  });
});

describe("findWaterline", () => {
  it("returns 0 when history fits in the retained rounds", () => {
    const history = [...makeRound(1), ...makeRound(2)];
    expect(findWaterline(history, 4)).toBe(0);
  });

  it("points at the start of the oldest retained round", () => {
    const history = [
      ...makeRound(1),
      ...makeRound(2),
      ...makeRound(3),
      ...makeRound(4),
      ...makeRound(5),
    ];
    // rounds start at 0,2,4,6,8; retain 4 -> waterline at round 2 (index 2)
    expect(findWaterline(history, 4)).toBe(2);
  });

  it("falls on round boundaries even with tool entries", () => {
    // each round: user, assistant(calls), tool, assistant -> starts 0,4,8
    const history = [...makeRound(1, 100), ...makeRound(2, 100)];
    const waterline = findWaterline(history, 1);
    expect(waterline).toBe(4);
    expect(history[waterline].role).toBe("user");
  });
});

describe("applyRuleBasedCompaction", () => {
  it("stubs tool entries below the waterline, keeps recent rounds intact", () => {
    const history = [
      ...makeRound(1, 5000),
      ...makeRound(2, 5000),
    ];
    const { history: next, changed } = applyRuleBasedCompaction(history, 4);
    expect(changed).toBe(true);
    expect(next[2].role).toBe("tool");
    if (next[2].role === "tool") {
      expect(next[2].content).toBe("[omitted]");
    }
    // recent round untouched
    expect(next[6].role).toBe("tool");
    if (next[6].role === "tool") {
      expect(next[6].content).toBe("x".repeat(5000));
    }
  });

  it("truncates long assistant tool-call argument values", () => {
    const long = "y".repeat(200);
    const history: Array<HistoryEntry> = [
      { role: "user", content: text("go") },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "tc-1", tool_name: "write_file", arguments: { content: long } },
        ],
      },
    ];
    const { history: next } = applyRuleBasedCompaction(history, 2);
    const tc = (next[1] as Extract<HistoryEntry, { role: "assistant" }>)
      .tool_calls![0];
    expect(tc.arguments.content).toBe(`y`.repeat(100) + "…(100 more chars)");
  });

  it("is idempotent", () => {
    const history = [...makeRound(1, 5000), ...makeRound(2, 5000)];
    const first = applyRuleBasedCompaction(history, 4);
    const second = applyRuleBasedCompaction(first.history, 4);
    expect(second.changed).toBe(false);
    expect(second.history).toEqual(first.history);
  });

  it("keeps tool results no longer than the stub intact", () => {
    const history: Array<HistoryEntry> = [
      { role: "user", content: text("go") },
      { role: "tool", tool_call_id: "orphan", name: "get_time", content: "12:00" },
    ];
    const { history: next } = applyRuleBasedCompaction(history, 2);
    // stubbing "12:00" would grow it, so the entry is left untouched
    expect(next[1]).toBe(history[1]);
  });
});

describe("serializeHistoryForSummary", () => {
  it("renders one line per entry with role markers", () => {
    const rendered = serializeHistoryForSummary([
      { role: "system", content: text("old summary") },
      { role: "user", content: text("hello") },
      {
        role: "assistant",
        content: "ok",
        tool_calls: [
          { id: "t1", tool_name: "read_file", arguments: { path: "a" } },
        ],
      },
      { role: "tool", tool_call_id: "t1", name: "read_file", content: "[omitted]" },
    ]);
    expect(rendered).toBe(
      [
        "[summary] old summary",
        "[user] hello",
        '[assistant] ok [calls: read_file({"path":"a"})]',
        "[tool read_file] [omitted]",
      ].join("\n"),
    );
  });
});

describe("compactAgent", () => {
  it("rule-based only: stubs old tool I/O, keeps recent rounds, skips LLM", async () => {
    const agent = Agent.create(template);
    agent.lastPromptTokens = 12345;
    agent.history = [
      { role: "system", content: text("sys") },
      ...makeRound(1, 5000),
      ...makeRound(2, 5000),
      ...makeRound(3),
    ];

    const { provider, calls } = makeProvider([], () => {
      throw new Error("provider should not be called");
    });
    const result = unwrap(await compactAgent({
      agent,
      provider,
      threshold: 100,
      retainRounds: 1,
    }));

    expect(calls).toHaveLength(0);
    expect(result.compacted).toBe(true);
    expect(result.beforeTokens).toBeGreaterThan(result.afterTokens);
    // old tool result stubbed (system entry + round 1: user, assistant, tool)
    expect(agent.history[3].role).toBe("tool");
    if (agent.history[3].role === "tool") {
      expect(agent.history[3].content).toBe("[omitted]");
    }
    // recent round (no bulky tool I/O) intact
    expect(agent.history[agent.history.length - 1]).toEqual({
      role: "assistant",
      content: "assistant reply 3",
    });
    // anchor invalidated
    expect(agent.lastPromptTokens).toBeUndefined();
  });

  it("escalates to LLM-based when rule-based cannot reach the threshold", async () => {
    const agent = Agent.create(template);
    // long user/assistant text only — rule-based has nothing to stub
    const longRounds: Array<HistoryEntry> = [];
    for (let n = 1; n <= 6; n++) {
      longRounds.push({ role: "user", content: text(`user ${n} ${"u".repeat(490)}`) });
      longRounds.push({ role: "assistant", content: `a ${"a".repeat(490)}` });
    }
    agent.history = [
      { role: "system", content: text("sys") },
      ...longRounds,
    ];

    const { provider, calls } = makeProvider([{ content: "SUMMARY TEXT" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = unwrap(await compactAgent({
      agent,
      provider,
      threshold: 1000,
      retainRounds: 2,
    }));
    warn.mockRestore();

    expect(result.compacted).toBe(true);
    expect(calls).toHaveLength(1);
    // summary call: system instruction + serialized aged entries (4 of 6 rounds)
    expect(calls[0].history).toHaveLength(2);
    expect(calls[0].history[0].role).toBe("system");
    if (calls[0].history[0].role === "system") {
      expect(contentText(calls[0].history[0].content)).toContain("compacting");
    }
    const serialized = calls[0].history[1].role === "user" ? contentText(calls[0].history[1].content) : "";
    expect(serialized).toContain("user 1 ");
    expect(serialized).not.toContain("user 5 ");

    // summary sits at history[0] as a system entry; 2 recent rounds remain
    expect(agent.history).toHaveLength(5);
    expect(agent.history[0].role).toBe("system");
    if (agent.history[0].role === "system") {
      expect(contentText(agent.history[0].content)).toContain("SUMMARY TEXT");
    }
  });

  it("abandons compaction when the summary leaves history no smaller than before", async () => {
    const agent = Agent.create(template);
    // One tiny round below the waterline (aged entries) plus big
    // retained rounds that push the whole thing over the threshold.
    agent.history = [
      { role: "system", content: text("sys") },
      ...makeRound(1),
      ...makeRound(2, 20000),
      ...makeRound(3, 20000),
      ...makeRound(4, 20000),
      ...makeRound(5, 20000),
    ];
    const originalLength = agent.history.length;

    // A summary far bigger than the few aged entries it replaces.
    const { provider } = makeProvider([{ content: "x".repeat(500) }]);
    const result = unwrap(await compactAgent({
      agent,
      provider,
      threshold: 1000,
      retainRounds: 4,
    }));

    // Net negative: the candidate summary is rejected. The rule pass had
    // nothing to stub here, so nothing was committed at all.
    expect(result.compacted).toBe(false);
    expect(result.afterTokens).toBeLessThanOrEqual(result.beforeTokens);
    expect(agent.history[0].role).toBe("system");
    if (agent.history[0].role === "system") {
      expect(contentText(agent.history[0].content)).toBe("sys");
    }
    // Same entry count as we started with — no summary was injected.
    expect(agent.history).toHaveLength(originalLength);
  });

  it("keeps the rule-compacted history when the summary costs more than it saves", async () => {
    const agent = Agent.create(template);
    // A tool round below the waterline (the rule pass stubs its result) plus
    // big retained rounds that keep the whole thing over the threshold.
    agent.history = [
      { role: "system", content: text("sys") },
      ...makeRound(1, 20000),
      ...makeRound(2, 20000),
      ...makeRound(3, 20000),
      ...makeRound(4, 20000),
      ...makeRound(5, 20000),
    ];
    // A summary far bigger than the aged entries it replaces.
    const { provider } = makeProvider([{ content: "x".repeat(2000) }]);
    const result = unwrap(await compactAgent({
      agent,
      provider,
      threshold: 1000,
      retainRounds: 4,
    }));

    // The summary candidate is rejected, but the rule pass (pure shortening)
    // is kept even though the history is still over the threshold.
    expect(result.compacted).toBe(true);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    expect(result.afterTokens).toBeGreaterThanOrEqual(1000);
    // No summary injected: the original system entry is intact.
    expect(agent.history[0].role).toBe("system");
    if (agent.history[0].role === "system") {
      expect(contentText(agent.history[0].content)).toBe("sys");
    }
    // Rule pass applied: the aged tool result is stubbed.
    expect((agent.history[3] as Extract<HistoryEntry, { role: "tool" }>).content).toBe(
      "[omitted]",
    );
    // Retained rounds untouched.
    expect((agent.history[19] as Extract<HistoryEntry, { role: "tool" }>).content).toBe(
      "x".repeat(20000),
    );
  });

  it("uses the per-template summary prompt when provided", async () => {
    const agent = Agent.create({
      ...template,
      compactSummaryPrompt: "CUSTOM: summarize briefly in one line",
    });
    const rounds: Array<HistoryEntry> = [];
    for (let n = 1; n <= 4; n++) {
      rounds.push({ role: "user", content: text(`user ${n} ${"u".repeat(1900)}`) });
      rounds.push({ role: "assistant", content: `a ${"a".repeat(1900)}` });
    }
    agent.history = [
      { role: "system", content: text("sys") },
      ...rounds,
    ];

    const { provider, calls } = makeProvider([{ content: "SUMMARY" }]);
    unwrap(await compactAgent({
      agent,
      provider,
      threshold: 1000,
      retainRounds: 1,
      summaryPrompt: "CUSTOM: summarize briefly in one line",
    }));

    expect(calls).toHaveLength(1);
    expect(calls[0].history[0].role).toBe("system");
    if (calls[0].history[0].role === "system") {
      expect(contentText(calls[0].history[0].content)).toBe(
        "CUSTOM: summarize briefly in one line",
      );
    }
  });

  it("re-summarizes a previous summary along with newly-aged rounds", async () => {
    const agent = Agent.create(template);
    const rounds: Array<HistoryEntry> = [];
    for (let n = 1; n <= 5; n++) {
      rounds.push({ role: "user", content: text(`user ${n} ${"u".repeat(490)}`) });
      rounds.push({ role: "assistant", content: `a ${"a".repeat(490)}` });
    }
    agent.history = [
      { role: "system", content: text("sys\n## History summary (compacted)\nold summary") },
      ...rounds,
    ];

    const { provider, calls } = makeProvider([{ content: "NEW SUMMARY" }]);
    unwrap(await compactAgent({ agent, provider, threshold: 500, retainRounds: 1 }));

    const serialized = calls[0].history[1].role === "user" ? contentText(calls[0].history[1].content) : "";
    // previous summary is re-fed explicitly; the aged entries are pure rounds
    expect(serialized).toContain("old summary");
    expect(serialized).not.toContain("[summary]");
    // the agent's system prompt ("sys") lives in the system entry, it is not
    // part of the re-fed previous summary
    expect(serialized).not.toContain("sys");
    // new system entry: template system prompt + new summary, single system entry
    expect(agent.history[0].role).toBe("system");
    if (agent.history[0].role === "system") {
      expect(contentText(agent.history[0].content)).toBe(
        "sys\n## History summary (compacted)\nNEW SUMMARY",
      );
    }
    expect(agent.history.filter((e) => e.role === "system")).toHaveLength(1);
  });

  it("rule-compacts the retained rounds themselves when they alone exceed the threshold", async () => {
    const agent = Agent.create(template);
    agent.history = [
      { role: "system", content: text("sys") },
      ...makeRound(1, 5000),
      ...makeRound(2, 5000),
    ];

    const { provider, calls } = makeProvider([], () => {
      throw new Error("provider should not be called");
    });
    const result = unwrap(await compactAgent({
      agent,
      provider,
      threshold: 1000,
      retainRounds: 4,
    }));

    expect(calls).toHaveLength(0);
    expect(result.compacted).toBe(true);
    expect(result.beforeTokens).toBeGreaterThan(result.afterTokens);
    // both tool results stubbed (no round is old enough for the waterline)
    for (const entry of agent.history) {
      if (entry.role === "tool") {
        expect(entry.content).toBe("[omitted]");
      }
    }
    expect(agent.lastPromptTokens).toBeUndefined();
  });

  it("accepts overflow when only retained rounds exist", async () => {
    const agent = Agent.create(template);
    agent.history = [{ role: "user", content: text("u".repeat(5000)) }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = unwrap(await compactAgent({
      agent,
      provider: null,
      threshold: 100,
      retainRounds: 4,
    }));

    expect(result.compacted).toBe(false);
    expect(agent.history).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does nothing and reports un-compacted when below the waterline and under threshold", async () => {
    const agent = Agent.create(template);
    agent.history = [...makeRound(1)];
    const { provider, calls } = makeProvider([], () => {
      throw new Error("provider should not be called");
    });
    const result = unwrap(await compactAgent({
      agent,
      provider,
      threshold: 100,
      retainRounds: 4,
    }));
    expect(result.compacted).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("agent token metering anchor", () => {
  it("anchors from LLM response usage and survives serialize round-trip", () => {
    const agent = Agent.create(template);
    agent.handleMessage({
      id: "m1",
      event_type: "message",
      chat_id: "c",
      adapter: "test",
      content: text("hi"),
      send_time: 0,
    });
    agent.handleLLMCompletionResponse({
      id: "r1",
      event_type: "llm_completion_response",
      to_agent_id: agent.id,
      content: "hello",
      usage: { prompt_tokens: 1234 },
    });
    expect(agent.lastPromptTokens).toBe(1234);

    const restored = Agent.deserialize(agent.serialize());
    expect(restored.lastPromptTokens).toBe(1234);

    restored.invalidateAnchor();
    expect(restored.lastPromptTokens).toBeUndefined();
  });

  it("leaves the anchor untouched when the provider omits usage", () => {
    const agent = Agent.create(template);
    agent.handleMessage({
      id: "m1",
      event_type: "message",
      chat_id: "c",
      adapter: "test",
      content: text("hi"),
      send_time: 0,
    });
    agent.handleLLMCompletionResponse({
      id: "r1",
      event_type: "llm_completion_response",
      to_agent_id: agent.id,
      content: "hello",
    });
    expect(agent.lastPromptTokens).toBeUndefined();
  });
});
