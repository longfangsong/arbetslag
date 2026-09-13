import { describe, it, expect } from "vitest";
import { ok, Result } from "neverthrow";

// Unwrap a Result; the test setups are valid, so a failure here is a real bug.
function unwrap<T>(r: Result<T, string>): T {
  return r.match((v) => v, (e) => {
    throw new Error(e);
  });
}
import { Orchestrator } from "./orchestrator";
import { Agent } from "./agent/model";
import type { HistoryEntry } from "./agent/history";
import { MessageEvent } from "./event/event";
import { InMemoryFileSystem } from "@/implementation/tool/file/filesystem/inMemory";
import { FileSystemAgentRepository } from "@/implementation/agent/repository";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";
import { InMemoryAIProviderRepository } from "@/implementation/aiProvider/inMemory";
import { ReadFile } from "@/implementation/tool/file/readFile";
import { WriteFile } from "@/implementation/tool/file/writeFile";
import { EditFile } from "@/implementation/tool/file/editFile";
import { DeleteFile } from "@/implementation/tool/file/deleteFile";
import { ListFiles } from "@/implementation/tool/file/listFiles";
import { HttpRequest } from "@/implementation/tool/http";
import { GetTime } from "@/implementation/tool/getTime";
import type { AIProvider } from "./aiProvider/model";
import type { Template } from "@/application/agent/template/model";
import type { OutputRouter } from "./outputRouter/model";

const sampleTemplate: Template = {
  name: "test",
  description: "A test template",
  ai_provider: "openai",
  model: "gpt-4",
  systemPrompt: "You are a test agent.",
  allowedTools: [],
};

function makeMessageEvent(chatId: string, content: string): MessageEvent {
  return {
    id: "evt-001",
    event_type: "message",
    chat_id: chatId,
    adapter: "telegram",
    content,
    send_time: Date.now(),
  };
}

function makeBuiltInTools() {
  return [
    new ReadFile(),
    new WriteFile(),
    new EditFile(),
    new DeleteFile(),
    new ListFiles(),
    new HttpRequest(),
    new GetTime(),
  ];
}

function makeToolRepo() {
  const tools = makeBuiltInTools();
  return {
    get tools() {
      return tools;
    },
    async getByName(name: string) {
      return tools.find((t) => t.name === name) ?? null;
    },
    getByNames(names: string[]) {
      return tools.filter((t) => names.includes(t.name));
    },
  };
}

function makeAiRepo(provider: AIProvider) {
  return new InMemoryAIProviderRepository([provider]);
}

function mockAiProvider(): AIProvider {
  return {
    name: "openai",
    async complete() {
      return ok({
        role: "assistant",
        content: "Hello from mock AI",
        tool_calls: [],
      });
    },
  };
}

describe("event_loop", () => {
  it("processes events until idle", async () => {
    const fs = new InMemoryFileSystem();
    const agentRepo = await FileSystemAgentRepository.create(
      fs,
      "test-agents/",
    );
    const templateRepo = await FileSystemTemplateRepository.create(
      fs,
      "test-templates/",
    );

    await templateRepo.add(sampleTemplate);

    const aiRepo = makeAiRepo(mockAiProvider());
    const outputRouter: OutputRouter = { async route() { return ok(undefined); } };

    const orchestrator = new Orchestrator({
      fileSystem: fs,
      agentRepository: agentRepo,
      templateRepository: templateRepo,
      toolRepository: makeToolRepo(),
      aiProviderRepository: aiRepo,
      outputRouter,
    });
    orchestrator.push(makeMessageEvent("chat-1", "Hi"));
    unwrap(await orchestrator.stepUntilIdle());

    expect(orchestrator.empty()).toBe(true);

    const list = await agentRepo.list();
    expect(list).toHaveLength(1);
    expect(list[0].chatId).toBe("chat-1");
    expect(list[0].history).toHaveLength(3);
    expect(list[0].history[1]).toEqual({ role: "user", content: "Hi" });
    expect(list[0].history[2]).toEqual({
      role: "assistant",
      content: "Hello from mock AI",
      tool_calls: [],
    });
  });

  it("handles multiple events across calls", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "test-templates/test.json",
      JSON.stringify(sampleTemplate),
    );

    const aiRepo = makeAiRepo(mockAiProvider());

    // First call
    {
      const orchestrator = new Orchestrator({
        fileSystem: fs,
        agentRepository: await FileSystemAgentRepository.create(
          fs,
          "test-agents/",
        ),
        templateRepository: await FileSystemTemplateRepository.create(
          fs,
          "test-templates/",
        ),
        toolRepository: makeToolRepo(),
        aiProviderRepository: aiRepo,
        outputRouter: null,
      });
      orchestrator.push(makeMessageEvent("chat-x", "First"));
      unwrap(await orchestrator.stepUntilIdle());
    }

    // Second call (reuses same agent from fs)
    {
      const orchestrator = new Orchestrator({
        fileSystem: fs,
        agentRepository: await FileSystemAgentRepository.create(
          fs,
          "test-agents/",
        ),
        templateRepository: await FileSystemTemplateRepository.create(
          fs,
          "test-templates/",
        ),
        toolRepository: makeToolRepo(),
        aiProviderRepository: aiRepo,
        outputRouter: null,
      });
      orchestrator.push(makeMessageEvent("chat-x", "Second"));
      unwrap(await orchestrator.stepUntilIdle());
    }

    const agentRepo = await FileSystemAgentRepository.create(
      fs,
      "test-agents/",
    );
    const agents = await agentRepo.list();
    expect(agents).toHaveLength(1);
    expect(agents[0].history).toHaveLength(5);
    expect(agents[0].history[1].content).toBe("First");
    expect(agents[0].history[2]).toEqual({
      role: "assistant",
      content: "Hello from mock AI",
      tool_calls: [],
    });
    expect(agents[0].history[3]).toEqual({ role: "user", content: "Second" });
    expect(agents[0].history[4]).toEqual({
      role: "assistant",
      content: "Hello from mock AI",
      tool_calls: [],
    });
  });
});

describe("compact", () => {
  const compactTemplate: Template = {
    name: "compact-test",
    description: "A compacting test template",
    ai_provider: "openai",
    model: "gpt-4",
    systemPrompt: "You are a test agent.",
    allowedTools: [],
    compactThreshold: 100,
    compactRetainRounds: 1,
  };

  function roundWithToolResult(n: number, resultSize = 4000): Array<HistoryEntry> {
    return [
      { role: "user", content: `question ${n}` },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: `tc-${n}`, tool_name: "read_file", arguments: { path: "a.txt" } },
        ],
      },
      {
        role: "tool",
        tool_call_id: `tc-${n}`,
        name: "read_file",
        content: "x".repeat(resultSize),
      },
    ];
  }

  async function makeOrchestrator(
    fs: InMemoryFileSystem,
    provider: AIProvider,
    notices: string[],
    template: Template = compactTemplate,
  ) {
    const agentRepo = await FileSystemAgentRepository.create(fs, "agents/");
    const templateRepo = await FileSystemTemplateRepository.create(fs, "templates/");
    return {
      agentRepo,
      templateRepo,
      orchestrator: new Orchestrator({
        fileSystem: fs,
        agentRepository: agentRepo,
        templateRepository: templateRepo,
        toolRepository: makeToolRepo(),
        aiProviderRepository: makeAiRepo(provider),
        outputRouter: {
          async route(event) {
            if ("kind" in event) notices.push(event.content);
            return ok(undefined);
          },
        },
      }),
    };
  }

  it("auto-compacts before the LLM request and sends a system notice", async () => {
    const fs = new InMemoryFileSystem();
    const notices: string[] = [];
    const seenByProvider: Array<Array<HistoryEntry>> = [];
    const provider: AIProvider = {
      name: "openai",
      async complete(_model, history) {
        seenByProvider.push(history);
        return ok({ role: "assistant", content: "ok", tool_calls: [] });
      },
    };
    const { agentRepo, templateRepo, orchestrator } = await makeOrchestrator(
      fs,
      provider,
      notices,
    );
    await templateRepo.add(compactTemplate);

    // Seed an agent whose anchor says the last request was already huge.
    const agent = Agent.create(compactTemplate);
    agent.chatId = "chat-1";
    agent.history = [
      { role: "system", content: compactTemplate.systemPrompt },
      ...roundWithToolResult(1),
      ...roundWithToolResult(2),
    ];
    agent.lastPromptTokens = 5000;
    await agentRepo.add(agent);
    await agentRepo.setEntryAgent("chat-1", agent);

    orchestrator.push(makeMessageEvent("chat-1", "hi"));
    unwrap(await orchestrator.stepUntilIdle());

    // Provider received system prompt + compacted history + the new message.
    expect(seenByProvider).toHaveLength(1);
    const sent = seenByProvider[0];
    expect(sent[0]).toEqual({ role: "system", content: compactTemplate.systemPrompt });
    expect(sent[sent.length - 1]).toEqual({ role: "user", content: "hi" });
    const toolEntries = sent.filter((e) => e.role === "tool");
    expect(toolEntries.length).toBeGreaterThan(0);
    for (const e of toolEntries) {
      if (e.role === "tool") expect(e.content).toMatch(/^\[omitted:read_file\]/);
    }

    // Agent was saved with stubbed history and the anchor was invalidated.
    // (system entry + round 1: user, assistant, tool, assistant → tool is index 3)
    const saved = (await agentRepo.getByChatId("chat-1"))!;
    expect(saved.lastPromptTokens).toBeUndefined();
    expect(
      (saved.history[3] as Extract<HistoryEntry, { role: "tool" }>).content,
    ).toMatch(/^\[omitted:read_file\]/);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^📦 Compacted history: ~\d+\.\d+K → ~/);
  });

  it("escalates to LLM-based and merges the summary into the system entry", async () => {
    const fs = new InMemoryFileSystem();
    const notices: string[] = [];
    const seenByProvider: Array<Array<HistoryEntry>> = [];
    const summaryTemplate: Template = {
      ...compactTemplate,
      compactSummaryPrompt: "CUSTOM: summarize in one line",
    };
    const provider: AIProvider = {
      name: "openai",
      async complete(_model, history) {
        seenByProvider.push(history);
        if (
          history.length === 2 &&
          history[0].role === "system" &&
          history[0].content.includes("CUSTOM")
        ) {
          return ok({ role: "assistant", content: "SUMMARY TEXT", tool_calls: [] });
        }
        return ok({ role: "assistant", content: "ok", tool_calls: [] });
      },
    };
    const { agentRepo, templateRepo, orchestrator } = await makeOrchestrator(
      fs,
      provider,
      notices,
    );
    await templateRepo.add(summaryTemplate);

    // Long text-only rounds: rule-based has nothing to stub.
    const agent = Agent.create(summaryTemplate);
    agent.chatId = "chat-1";
    agent.history = [
      { role: "system", content: summaryTemplate.systemPrompt },
    ];
    for (let n = 1; n <= 3; n++) {
      agent.history.push({ role: "user", content: `q ${n} ${"u".repeat(200)}` });
      agent.history.push({ role: "assistant", content: `a ${"a".repeat(200)}` });
    }
    await agentRepo.add(agent);
    await agentRepo.setEntryAgent("chat-1", agent);

    orchestrator.push(makeMessageEvent("chat-1", "hi"));
    unwrap(await orchestrator.stepUntilIdle());

    // 1st call = summarization; 2nd call = the real completion.
    expect(seenByProvider).toHaveLength(2);
    expect(seenByProvider[0]).toHaveLength(2);
    const completion = seenByProvider[1];
    // Single system entry: the bare system prompt plus the summary.
    expect(completion[0].role).toBe("system");
    if (completion[0].role === "system") {
      expect(completion[0].content).toContain(summaryTemplate.systemPrompt);
      expect(completion[0].content).toContain("SUMMARY TEXT");
    }

    const saved = (await agentRepo.getByChatId("chat-1"))!;
    expect(saved.history[0].role).toBe("system");
    expect(notices).toHaveLength(1);
  });

  it("processes compact_request: compacts and notifies; no agent -> creates one, nothing to compact", async () => {
    const fs = new InMemoryFileSystem();
    const notices: string[] = [];
    const provider = mockAiProvider();
    // High threshold: the retained round plus stubs stay under it, so
    // rule-based alone is expected to settle it.
    const template = { ...compactTemplate, compactThreshold: 1000 };
    const { agentRepo, templateRepo, orchestrator } = await makeOrchestrator(
      fs,
      provider,
      notices,
      template,
    );
    await templateRepo.add(template);

    const agent = Agent.create(template);
    agent.chatId = "chat-1";
    agent.history = [
      ...roundWithToolResult(1),
      ...roundWithToolResult(2),
      ...roundWithToolResult(3, 100),
    ];
    await agentRepo.add(agent);
    await agentRepo.setEntryAgent("chat-1", agent);

    orchestrator.push({ id: "c1", event_type: "compact_request", chat_id: "chat-1" });
    unwrap(await orchestrator.stepUntilIdle());

    // retainRounds=1 -> rounds 1-2 stubbed, round 3 intact
    const saved = (await agentRepo.getByChatId("chat-1"))!;
    expect((saved.history[2] as Extract<HistoryEntry, { role: "tool" }>).content).toMatch(
      /^\[omitted:read_file\]/,
    );
    expect((saved.history[8] as Extract<HistoryEntry, { role: "tool" }>).content).toBe(
      "x".repeat(100),
    );
    expect(notices[0]).toMatch(/^📦 Compacted history:/);

    orchestrator.push({ id: "c2", event_type: "compact_request", chat_id: "nope" });
    unwrap(await orchestrator.stepUntilIdle());
    // No agent for "nope" yet -> one is created (default template), and an
    // empty history has nothing to compact.
    expect(await agentRepo.getByChatId("nope")).not.toBeNull();
    expect(notices[1]).toBe("📦 Nothing to compact");
  });
});
