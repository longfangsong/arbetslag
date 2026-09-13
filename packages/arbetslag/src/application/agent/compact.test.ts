import { describe, it, expect, vi } from "vitest";
import {
  estimateTokens,
  findWaterline,
  applyRuleBasedCompaction,
  serializeHistoryForSummary,
  formatCompactNotice,
  NOTHING_TO_COMPACT,
  compactAgent,
} from "./compact";
import { Agent } from "./model";
import type { Template } from "./template/model";
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
      return {
        role: "assistant",
        content: r.content ?? "",
        tool_calls: r.tool_calls,
      };
    },
  };
  return { provider, calls };
}

/** user + (optional tool call with long result) + assistant reply */
function makeRound(n: number, toolResultLength = 0): Array<HistoryEntry> {
  const entries: Array<HistoryEntry> = [
    { role: "user", content: `user message ${n}` },
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
      expect(next[2].content).toMatch(
        /^\[omitted:read_file\] args=.*$/,
      );
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
      { role: "user", content: "go" },
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

  it("stubs tool entries whose matching assistant call is unknown without args", () => {
    const history: Array<HistoryEntry> = [
      { role: "user", content: "go" },
      { role: "tool", tool_call_id: "orphan", name: "get_time", content: "12:00" },
    ];
    const { history: next } = applyRuleBasedCompaction(history, 2);
    expect(next[1].role).toBe("tool");
    if (next[1].role === "tool") {
      expect(next[1].content).toBe("[omitted:get_time]");
    }
  });
});

describe("serializeHistoryForSummary", () => {
  it("renders one line per entry with role markers", () => {
    const text = serializeHistoryForSummary([
      { role: "system", content: "old summary" },
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: "ok",
        tool_calls: [
          { id: "t1", tool_name: "read_file", arguments: { path: "a" } },
        ],
      },
      { role: "tool", tool_call_id: "t1", name: "read_file", content: "[omitted:read_file]" },
    ]);
    expect(text).toBe(
      [
        "[summary] old summary",
        "[user] hello",
        '[assistant] ok [calls: read_file({"path":"a"})]',
        "[tool read_file] [omitted:read_file]",
      ].join("\n"),
    );
  });
});

describe("notices", () => {
  it("formats the compact notice", () => {
    expect(formatCompactNotice(31200, 4100)).toBe(
      "📦 Compacted history: ~31.2K → ~4.1K tokens",
    );
    expect(NOTHING_TO_COMPACT).toBe("📦 Nothing to compact");
  });
});

describe("compactAgent", () => {
  it("rule-based only: stubs old tool I/O, keeps recent rounds, skips LLM", async () => {
    const agent = Agent.create(template);
    agent.lastPromptTokens = 12345;
    agent.history = [
      { role: "system", content: "sys" },
      ...makeRound(1, 5000),
      ...makeRound(2, 5000),
      ...makeRound(3),
    ];

    const { provider, calls } = makeProvider([], () => {
      throw new Error("provider should not be called");
    });
    const result = await compactAgent({
      agent,
      provider,
      threshold: 100,
      retainRounds: 1,
    });

    expect(calls).toHaveLength(0);
    expect(result.compacted).toBe(true);
    expect(result.beforeTokens).toBeGreaterThan(result.afterTokens);
    // old tool result stubbed (system entry + round 1: user, assistant, tool)
    expect(agent.history[3].role).toBe("tool");
    if (agent.history[3].role === "tool") {
      expect(agent.history[3].content).toMatch(/^\[omitted:read_file\]/);
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
      longRounds.push({ role: "user", content: `user ${n} ${"u".repeat(490)}` });
      longRounds.push({ role: "assistant", content: `a ${"a".repeat(490)}` });
    }
    agent.history = [
      { role: "system", content: "sys" },
      ...longRounds,
    ];

    const { provider, calls } = makeProvider([{ content: "SUMMARY TEXT" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await compactAgent({
      agent,
      provider,
      threshold: 1000,
      retainRounds: 2,
    });
    warn.mockRestore();

    expect(result.compacted).toBe(true);
    expect(calls).toHaveLength(1);
    // summary call: system instruction + serialized segment (4 of 6 rounds)
    expect(calls[0].history).toHaveLength(2);
    expect(calls[0].history[0].role).toBe("system");
    if (calls[0].history[0].role === "system") {
      expect(calls[0].history[0].content).toContain("compacting");
    }
    const serialized = calls[0].history[1].role === "user" ? calls[0].history[1].content : "";
    expect(serialized).toContain("user 1 ");
    expect(serialized).not.toContain("user 5 ");

    // summary sits at history[0] as a system entry; 2 recent rounds remain
    expect(agent.history).toHaveLength(5);
    expect(agent.history[0].role).toBe("system");
    if (agent.history[0].role === "system") {
      expect(agent.history[0].content).toContain("SUMMARY TEXT");
    }
  });

  it("uses the per-template summary prompt when provided", async () => {
    const agent = Agent.create({
      ...template,
      compactSummaryPrompt: "CUSTOM: summarize briefly in one line",
    });
    const rounds: Array<HistoryEntry> = [];
    for (let n = 1; n <= 4; n++) {
      rounds.push({ role: "user", content: `user ${n} ${"u".repeat(1900)}` });
      rounds.push({ role: "assistant", content: `a ${"a".repeat(1900)}` });
    }
    agent.history = [
      { role: "system", content: "sys" },
      ...rounds,
    ];

    const { provider, calls } = makeProvider([{ content: "SUMMARY" }]);
    await compactAgent({
      agent,
      provider,
      threshold: 1000,
      retainRounds: 1,
      summaryPrompt: "CUSTOM: summarize briefly in one line",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].history[0].role).toBe("system");
    if (calls[0].history[0].role === "system") {
      expect(calls[0].history[0].content).toBe(
        "CUSTOM: summarize briefly in one line",
      );
    }
  });

  it("re-summarizes a previous summary along with newly-aged rounds", async () => {
    const agent = Agent.create(template);
    const rounds: Array<HistoryEntry> = [];
    for (let n = 1; n <= 5; n++) {
      rounds.push({ role: "user", content: `user ${n} ${"u".repeat(490)}` });
      rounds.push({ role: "assistant", content: `a ${"a".repeat(490)}` });
    }
    agent.history = [
      { role: "system", content: "sys\n## History summary (compacted)\nold summary" },
      ...rounds,
    ];

    const { provider, calls } = makeProvider([{ content: "NEW SUMMARY" }]);
    await compactAgent({ agent, provider, threshold: 500, retainRounds: 1 });

    const serialized = calls[0].history[1].role === "user" ? calls[0].history[1].content : "";
    // previous summary is re-fed explicitly; the segment itself is pure rounds
    expect(serialized).toContain("old summary");
    expect(serialized).not.toContain("[summary]");
    // new system entry: template system prompt + new summary, single system entry
    expect(agent.history[0].role).toBe("system");
    if (agent.history[0].role === "system") {
      expect(agent.history[0].content).toBe(
        "sys\n## History summary (compacted)\nNEW SUMMARY",
      );
    }
    expect(agent.history.filter((e) => e.role === "system")).toHaveLength(1);
  });

  it("accepts overflow when only retained rounds exist", async () => {
    const agent = Agent.create(template);
    agent.history = [{ role: "user", content: "u".repeat(5000) }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await compactAgent({
      agent,
      provider: null,
      threshold: 100,
      retainRounds: 4,
    });

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
    const result = await compactAgent({
      agent,
      provider,
      threshold: 100,
      retainRounds: 4,
    });
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
      content: "hi",
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
      content: "hi",
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
