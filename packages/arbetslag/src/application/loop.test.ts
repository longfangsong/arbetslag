import { describe, it, expect } from "vitest";
import { ok } from "neverthrow";
import z from "zod";
import { unwrap } from "../utils";
import { Orchestrator } from "./orchestrator";
import { Agent, composeSystemPrompt } from "./agent/model";
import { openWait, reportOf } from "./agent/report";
import { InMemoryAgentRepository } from "@/implementation/agent/repository.memory";
import { WaitForAgent } from "@/implementation/tool/waitForAgent";
import { SUMMARY_MARKER } from "./agent/compact";
import type { Content, HistoryEntry, ToolCall } from "./agent/history";
import { contentText, text } from "./agent/history";
import type { AgentOutput, MessageEvent } from "./event/event";
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
import type { OutputRouter, Compacted } from "./outputRouter/model";
import type { Tool } from "./tool/model";
import { CreateAgent } from "@/implementation/tool/createAgent";

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
    content: text(content),
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
    expect(list[0].history[1]).toEqual({ role: "user", content: text("Hi") });
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
    expect(agents[0].history[1].content).toEqual(text("First"));
    expect(agents[0].history[2]).toEqual({
      role: "assistant",
      content: "Hello from mock AI",
      tool_calls: [],
    });
    expect(agents[0].history[3]).toEqual({ role: "user", content: text("Second") });
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
    compactThreshold: 256,
    compactRetainRounds: 1,
  };

  function roundWithToolResult(n: number, resultSize = 4000): Array<HistoryEntry> {
    return [
      { role: "user", content: text(`question ${n}`) },
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
    notices: Compacted[],
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
            if ("kind" in event) notices.push(event);
            return ok(undefined);
          },
        },
      }),
    };
  }

  it("escalates to LLM-based and merges the summary into the system entry", async () => {
    const fs = new InMemoryFileSystem();
    const notices: Compacted[] = [];
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
          contentText(history[0].content).includes("CUSTOM")
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
      { role: "system", content: text(summaryTemplate.systemPrompt) },
    ];
    for (let n = 1; n <= 3; n++) {
      agent.history.push({ role: "user", content: text(`q ${n} ${"u".repeat(200)}`) });
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
      expect(contentText(completion[0].content)).toContain(summaryTemplate.systemPrompt);
      expect(contentText(completion[0].content)).toContain("SUMMARY TEXT");
    }

    const saved = (await agentRepo.getByChatId("chat-1"))!;
    expect(saved.history[0].role).toBe("system");
    expect(notices).toHaveLength(1);
  });

  it("processes compact_request: compacts and notifies; no agent -> creates one, nothing to compact", async () => {
    const fs = new InMemoryFileSystem();
    const notices: Compacted[] = [];
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
      "[omitted]",
    );
    expect((saved.history[8] as Extract<HistoryEntry, { role: "tool" }>).content).toBe(
      "x".repeat(100),
    );
    expect(notices[0]).toMatchObject({ kind: "history_compacted" });
    expect(notices[0].beforeTokens).toBeTypeOf("number");

    orchestrator.push({ id: "c2", event_type: "compact_request", chat_id: "nope" });
    unwrap(await orchestrator.stepUntilIdle());
    // No agent for "nope" yet -> one is created (default template), and an
    // empty history has nothing to compact.
    expect(await agentRepo.getByChatId("nope")).not.toBeNull();
    // nothing compacted -> no token counts
    expect(notices[1].beforeTokens).toBeUndefined();
    expect(notices[1].afterTokens).toBeUndefined();
  });
});

describe("tool call pairing", () => {
  it("decrements the waiting count only for the tool call a response answers", () => {
    const agent = Agent.create(sampleTemplate);
    agent.handleLLMCompletionResponse({
      id: "r1",
      event_type: "llm_completion_response",
      to_agent_id: agent.id,
      content: "",
      tool_calls: [{ id: "tc-1", tool_name: "get_time", arguments: {} }],
    });

    const orphan = agent.handleToolResponse({
      id: "orphan",
      event_type: "tool_call_response",
      to_agent_id: agent.id,
      name: "get_time",
      content: "12:00",
    });
    expect(orphan).toHaveLength(0); // still waiting for tc-1

    const paired = agent.handleToolResponse({
      id: "tc-1",
      event_type: "tool_call_response",
      to_agent_id: agent.id,
      name: "get_time",
      content: "12:01",
    });
    expect(paired).toHaveLength(1);
  });
});

describe("tool pushEvent", () => {
  it("processes an event pushed by a tool in a later step, after the tool's own response", async () => {
    const fs = new InMemoryFileSystem();
    const agentRepo = await FileSystemAgentRepository.create(fs, "push-agents/");
    const templateRepo = await FileSystemTemplateRepository.create(fs, "push-templates/");
    await templateRepo.add(sampleTemplate);

    const tool: Tool<unknown, unknown, unknown> = {
      name: "pusher",
      description: "queues an event for a later step",
      inputSchema: z.object({}),
      async call(context, caller) {
        context.pushEvent({
          id: "p1",
          event_type: "api_callback",
          to_agent_id: caller.id,
          api_name: "pusher",
          content: "callback payload",
        });
        return ok("acked");
      },
    };

    let calls = 0;
    const provider: AIProvider = {
      name: "openai",
      async complete() {
        calls += 1;
        return calls === 1
          ? ok({
              role: "assistant",
              content: "",
              tool_calls: [{ id: "tc-1", tool_name: "pusher", arguments: {} }],
            })
          : ok({ role: "assistant", content: "done", tool_calls: [] });
      },
    };

    const orchestrator = new Orchestrator({
      fileSystem: fs,
      agentRepository: agentRepo,
      templateRepository: templateRepo,
      toolRepository: {
        tools: [tool],
        async getByName(name: string) {
          return name === tool.name ? tool : null;
        },
        getByNames(names: string[]) {
          return names.includes(tool.name) ? [tool] : [];
        },
      },
      aiProviderRepository: makeAiRepo(provider),
      outputRouter: null,
    });

    orchestrator.push(makeMessageEvent("chat-9", "go"));
    unwrap(await orchestrator.stepUntilIdle());

    const agent = (await agentRepo.list())[0];
    const toolResult = agent.history[3] as Extract<HistoryEntry, { role: "tool" }>;
    expect(toolResult.tool_call_id).toBe("tc-1");
    expect(toolResult.content).toBe('"acked"');
    // the pushed event ran in a later step, after this tool call resolved
    const callbackEntry = agent.history[4] as Extract<HistoryEntry, { role: "user" | "system" }>;
    expect(contentText(callbackEntry.content)).toContain("callback payload");
  });
});

describe("create_agent", () => {
  const entryTemplate: Template = {
    name: "entry",
    description: "",
    ai_provider: "openai",
    model: "gpt-4",
    systemPrompt: "ENTRY",
    allowedTools: ["create_agent", "get_time"],
  };
  const workerTemplate: Template = {
    name: "worker",
    description: "",
    ai_provider: "openai",
    model: "gpt-4",
    systemPrompt: "WORKER",
    allowedTools: ["get_time"],
  };

  async function makeLoop(provider: AIProvider, agentsDir: string, templatesDir: string) {
    const fs = new InMemoryFileSystem();
    const agentRepo = await FileSystemAgentRepository.create(fs, agentsDir);
    const templateRepo = await FileSystemTemplateRepository.create(fs, templatesDir);
    await templateRepo.add(entryTemplate);
    await templateRepo.add(workerTemplate);
    const tools: Array<Tool<unknown, unknown, unknown>> = [new CreateAgent(), new GetTime()];
    return {
      orchestrator: new Orchestrator({
        fileSystem: fs,
        agentRepository: agentRepo,
        templateRepository: templateRepo,
        toolRepository: {
          tools,
          async getByName(name: string) {
            return tools.find((t) => t.name === name) ?? null;
          },
          getByNames(names: string[]) {
            return tools.filter((t) => names.includes(t.name));
          },
        },
        aiProviderRepository: makeAiRepo(provider),
        outputRouter: null,
      }),
      agentRepo,
    };
  }

  const toolContent = (entry: HistoryEntry) =>
    String((entry as Extract<HistoryEntry, { role: "tool" }>).content);

  it("creates a Sub-agent, acks at once, delivers the task as its first message", async () => {
    const toolsPerTemplate = new Map<string, Array<string>>();
    const provider: AIProvider = {
      name: "openai",
      async complete(_model, history, allowedTools) {
        const isWorker = contentText(history[0].content as Content).includes("WORKER");
        toolsPerTemplate.set(isWorker ? "worker" : "entry", allowedTools.map((t) => t.name));
        if (history.length > 2) {
          return ok({
            role: "assistant",
            content: isWorker ? "worker answer" : "entry answer",
            tool_calls: [],
          });
        }
        return isWorker
          ? ok({ role: "assistant", content: "", tool_calls: [{ id: "tc-w", tool_name: "get_time", arguments: {} }] })
          : ok({
              role: "assistant",
              content: "",
              tool_calls: [
                { id: "tc-e", tool_name: "create_agent", arguments: { template: "worker", task: "count the files" } },
              ],
            });
      },
    };

    const { orchestrator, agentRepo } = await makeLoop(provider, "create-agents/", "create-templates/");
    orchestrator.push(makeMessageEvent("chat-10", "go"));
    unwrap(await orchestrator.stepUntilIdle());

    const agents = await agentRepo.list();
    const entry = agents.find((a) => a.chatId)!;
    const worker = agents.find((a) => a.createdByAgentId)!;
    expect(agents).toHaveLength(2);
    expect(worker.createdByAgentId).toBe(entry.id);

    // the ack carries no work result
    expect(JSON.parse(toolContent(entry.history[3]))).toEqual({
      agentId: worker.id,
      status: "created",
    });

    // the task is the Sub-agent's first message → a Round boundary
    const firstMessage = contentText(
      (worker.history[1] as Extract<HistoryEntry, { role: "system" | "user" }>).content,
    );
    expect(firstMessage).toContain("<agent_message>");
    expect(firstMessage).toContain(`<from_agent_id>${entry.id}</from_agent_id>`);
    expect(firstMessage).toContain("count the files");

    // the Sub-agent worked (one tool call) while the Creator was not waiting
    expect((worker.history[2] as { tool_calls?: Array<ToolCall> }).tool_calls).toHaveLength(1);
    expect(worker.history[3].role).toBe("tool");

    // the Creator sees only its own ack, not the Sub-agent's answer
    expect(entry.history[4]).toMatchObject({ role: "assistant", content: "entry answer" });
    // create_agent is listed only for the Template that declares it
    expect(toolsPerTemplate.get("entry")).toContain("create_agent");
    expect(toolsPerTemplate.get("worker")).toEqual(["get_time"]);
    expect(orchestrator.empty()).toBe(true);
  });

  it("errors when creating past the global maximum depth of 3", async () => {
    const provider: AIProvider = {
      name: "openai",
      async complete(_model, history) {
        if (history.length > 2) return ok({ role: "assistant", content: "done", tool_calls: [] });
        return ok({
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "tc-d", tool_name: "create_agent", arguments: { template: "worker", task: "recurse" } },
          ],
        });
      },
    };

    const { orchestrator, agentRepo } = await makeLoop(provider, "depth-agents/", "depth-templates/");
    orchestrator.push(makeMessageEvent("chat-11", "go"));
    unwrap(await orchestrator.stepUntilIdle());

    const agents = await agentRepo.list();
    const depthOf = (agent: Agent) => {
      let depth = 1;
      let current: Agent | undefined = agent;
      while (current?.createdByAgentId) {
        current = agents.find((a) => a.id === current!.createdByAgentId);
        depth++;
      }
      return depth;
    };
    expect(agents.map(depthOf)).toEqual([1, 2, 3]); // entry → worker → worker, no 4th
    expect(toolContent(agents.find((a) => depthOf(a) === 3)!.history[3])).toContain(
      "Maximum Sub-agent depth of 3 exceeded",
    );
  });
});

describe("report", () => {
  const entryTemplate: Template = {
    name: "entry",
    description: "",
    ai_provider: "openai",
    model: "gpt-4",
    systemPrompt: "ENTRY",
    allowedTools: ["create_agent", "get_time"],
  };
  const workerTemplate: Template = {
    ...entryTemplate,
    name: "worker",
    systemPrompt: "WORKER",
    allowedTools: ["get_time"],
  };

  // worker turn 1: mid-turn content with a tool call (not a Report)
  // worker turn 2: final answer → Report; worker turn 3: empty turn → empty Report
  function makeProvider(workerTurns: Array<string>): AIProvider {
    let workerCall = 0;
    return {
      name: "openai",
      async complete(_model, history) {
        if (!contentText(history[0].content as Content).includes("WORKER")) {
          return history.length > 2
            ? ok({ role: "assistant", content: "entry answer", tool_calls: [] })
            : ok({
                role: "assistant",
                content: "",
                tool_calls: [
                  { id: "tc-e", tool_name: "create_agent", arguments: { template: "worker", task: "count the files" } },
                ],
              });
        }
        const content = workerTurns[workerCall++];
        return workerCall === 1
          ? ok({ role: "assistant", content, tool_calls: [{ id: "tc-w", tool_name: "get_time", arguments: {} }] })
          : ok({ role: "assistant", content, tool_calls: [] });
      },
    };
  }

  async function makeHarness(provider: AIProvider, routed: Array<AgentOutput>) {
    const fs = new InMemoryFileSystem();
    const agentRepo = await FileSystemAgentRepository.create(fs, "report-agents/");
    const templateRepo = await FileSystemTemplateRepository.create(fs, "report-templates/");
    await templateRepo.add(entryTemplate);
    await templateRepo.add(workerTemplate);
    const tools = [new CreateAgent(), new GetTime()];
    const orchestrator = new Orchestrator({
      fileSystem: fs,
      agentRepository: agentRepo,
      templateRepository: templateRepo,
      toolRepository: {
        tools,
        async getByName(name: string) {
          return tools.find((t) => t.name === name) ?? null;
        },
        getByNames(names: string[]) {
          return tools.filter((t) => names.includes(t.name));
        },
      },
      aiProviderRepository: makeAiRepo(provider),
      outputRouter: {
        async route(event) {
          if ("event_type" in event) routed.push(event);
          return ok(undefined);
        },
      },
    });
    return { fs, agentRepo, orchestrator };
  }

  async function runFlow(turns: Array<string>, followUp = true) {
    const routed: Array<AgentOutput> = [];
    const { fs, agentRepo, orchestrator } = await makeHarness(makeProvider(turns), routed);
    orchestrator.push(makeMessageEvent("chat-12", "go"));
    unwrap(await orchestrator.stepUntilIdle());
    const agents = await agentRepo.list();
    const entry = agents.find((a) => a.chatId)!;
    const worker = agents.find((a) => a.createdByAgentId)!;
    if (!followUp) return { fs, entry, worker, routed };
    // second turn: an empty-content turn still produces a Report
    orchestrator.push({
      id: "m1",
      event_type: "agent_message",
      from_agent_id: entry.id,
      to_agent_id: worker.id,
      content: "still there?",
    });
    unwrap(await orchestrator.stepUntilIdle());
    const after = await agentRepo.list();
    return {
      fs,
      entry: after.find((a) => a.chatId)!,
      worker: after.find((a) => a.createdByAgentId)!,
      routed,
    };
  }

  it("the Report is the turn-ending assistant entry, not mid-turn content", async () => {
    const { entry, worker, routed } = await runFlow(["mid-turn chatter", "final answer"], false);
    expect(reportOf(worker)).toBe("final answer");
    // a Sub-agent is not routed to the user; the user-facing agent still is
    expect(routed.map((r) => r.from_agent_id)).toEqual([entry.id]);
    expect(routed[0].content).toBe("entry answer");
  });

  it("the last ended turn wins, and an empty ended turn is an empty Report", async () => {
    const { worker } = await runFlow(["mid-turn chatter", "first answer", ""]);
    expect(reportOf(worker)).toBe("");
  });

  it("a compacted Report stands in as the summary", () => {
    const agent = Agent.deserialize({
      id: "w",
      template: workerTemplate,
      history: [
        { role: "system", content: text(`ENTRY${SUMMARY_MARKER}summarized answer`) },
        { role: "user", content: text("still there?") },
      ],
    });
    expect(reportOf(agent)).toBe("summarized answer");
  });
});

describe("wait_for_agent", () => {
  const entryTemplate: Template = {
    name: "wait-entry",
    description: "",
    ai_provider: "openai",
    model: "gpt-4",
    systemPrompt: "ENTRY",
    allowedTools: ["create_agent", "wait_for_agent", "get_time"],
  };
  const workerATemplate: Template = {
    ...entryTemplate,
    name: "worker_a",
    systemPrompt: "WORKER_A",
    allowedTools: ["get_time"],
  };
  const workerBTemplate: Template = {
    ...entryTemplate,
    name: "worker_b",
    systemPrompt: "WORKER_B",
    allowedTools: ["get_time"],
  };

  type ScriptStep = (agents: Array<Agent>) => {
    content?: string;
    toolCalls?: Array<ToolCall>;
  };

  async function harness(
    script: Record<string, Array<ScriptStep>>,
    agentRepo: InMemoryAgentRepository = new InMemoryAgentRepository(),
  ) {
    const fs = new InMemoryFileSystem();
    const templateRepo = await FileSystemTemplateRepository.create(fs, "wait-templates/");
    for (const t of [entryTemplate, workerATemplate, workerBTemplate]) await templateRepo.add(t);
    const tools = [new CreateAgent(), new WaitForAgent(), new GetTime()];
    const calls: Record<string, number> = {};
    const provider: AIProvider = {
      name: "openai",
      async complete(_model: string, history: Array<HistoryEntry>) {
        const system = contentText(history[0].content as Content);
        const key = system.includes("ENTRY") ? "entry" : system.includes("WORKER_A") ? "a" : "b";
        const step = script[key][calls[key] ?? 0](await agentRepo.list());
        calls[key] = (calls[key] ?? 0) + 1;
        return ok({ role: "assistant", content: step.content ?? "", tool_calls: step.toolCalls });
      },
    };
    const orchestrator = new Orchestrator({
      fileSystem: fs,
      agentRepository: agentRepo,
      templateRepository: templateRepo,
      toolRepository: {
        tools,
        async getByName(name: string) {
          return tools.find((t) => t.name === name) ?? null;
        },
        getByNames(names: Array<string>) {
          return tools.filter((t) => names.includes(t.name));
        },
      },
      aiProviderRepository: makeAiRepo(provider),
      outputRouter: null,
    });
    return { orchestrator, agentRepo, calls };
  }

  function toolResultOf(agent: Agent, toolCallId: string) {
    const e = agent.history.find((e) => e.role === "tool" && e.tool_call_id === toolCallId);
    if (!e) return undefined;
    return typeof e.content === "string" ? e.content : contentText(e.content);
  }

  function waitOf(agents: Array<Agent>, templateName: string, toolCallId: string): ToolCall {
    return {
      id: toolCallId,
      tool_name: "wait_for_agent",
      arguments: { agent_id: agents.find((a) => a.template.name === templateName)!.id },
    };
  }

  it("end-to-end: the wait stays open, the sub-agent is processed, its report becomes the tool result", async () => {
    const { orchestrator, agentRepo, calls } = await harness({
      entry: [
        () => ({
          toolCalls: [
            { id: "c1", tool_name: "create_agent", arguments: { template: "worker_a", task: "count" } },
          ],
        }),
        (agents) => ({ toolCalls: [waitOf(agents, "worker_a", "w1")] }),
        () => ({ content: "got it" }),
      ],
      a: [
        () => ({ toolCalls: [{ id: "ga", tool_name: "get_time", arguments: {} }] }),
        () => ({ content: "report A" }),
      ],
      b: [],
    });

    orchestrator.push(makeMessageEvent("chat-13", "go"));
    const openWhilePending: Array<boolean> = [];
    for (let i = 0; i < 20 && !orchestrator.empty(); i++) {
      unwrap(await orchestrator.step());
      const entry = await agentRepo.getByChatId("chat-13");
      openWhilePending.push(
        !toolResultOf(entry!, "w1") && calls["entry"] === 2 && !orchestrator.empty(),
      );
    }

    // While the Wait was open there was no response for it, the Creator was not
    // re-prompted, and the waited-for Agent's events were still processed.
    expect(openWhilePending.some(Boolean)).toBe(true);

    const entry = (await agentRepo.getByChatId("chat-13"))!;
    const sub = (await agentRepo.list()).find((a) => a.createdByAgentId === entry.id)!;
    expect(reportOf(sub)).toBe("report A");
    expect(JSON.parse(toolResultOf(entry, "w1")!)).toBe("report A");
    expect(calls["entry"]).toBe(3); // the Creator is re-prompted when the Wait answers
    expect(calls["a"]).toBe(2);
  });

  it("reads only the Report of the Agent it names and re-prompts only when every open tool call answered", async () => {
    const { orchestrator, agentRepo, calls } = await harness({
      entry: [
        () => ({
          toolCalls: [
            { id: "c1", tool_name: "create_agent", arguments: { template: "worker_a", task: "count" } },
            { id: "c2", tool_name: "create_agent", arguments: { template: "worker_b", task: "count" } },
          ],
        }),
        (agents) => ({ toolCalls: [waitOf(agents, "worker_a", "w1"), waitOf(agents, "worker_b", "w2")] }),
        () => ({ content: "both collected" }),
      ],
      a: [
        () => ({ toolCalls: [{ id: "ga", tool_name: "get_time", arguments: {} }] }),
        () => ({ content: "report A" }),
      ],
      b: [
        () => ({ toolCalls: [{ id: "gb", tool_name: "get_time", arguments: {} }] }),
        () => ({ content: "report B" }),
      ],
    });

    orchestrator.push(makeMessageEvent("chat-14", "go"));
    const oneAnsweredNotReprompted: Array<boolean> = [];
    for (let i = 0; i < 30 && !orchestrator.empty(); i++) {
      unwrap(await orchestrator.step());
      const entry = (await agentRepo.getByChatId("chat-14"))!;
      const answered = entry.history.filter(
        (e) => e.role === "tool" && (e.tool_call_id === "w1" || e.tool_call_id === "w2"),
      ).length;
      oneAnsweredNotReprompted.push(answered === 1 && calls["entry"] === 2);
    }

    expect(oneAnsweredNotReprompted.some(Boolean)).toBe(true);

    const entry = (await agentRepo.getByChatId("chat-14"))!;
    expect(JSON.parse(toolResultOf(entry, "w1")!)).toBe("report A");
    expect(JSON.parse(toolResultOf(entry, "w2")!)).toBe("report B");
    expect(calls["entry"]).toBe(3); // re-prompted only after both Waits answered
  });

  it("mid-turn content does not answer an open Wait — only the turn-ending output does", async () => {
    const { orchestrator, agentRepo, calls } = await harness({
      entry: [
        () => ({
          toolCalls: [
            { id: "c1", tool_name: "create_agent", arguments: { template: "worker_a", task: "count" } },
          ],
        }),
        (agents) => ({ toolCalls: [waitOf(agents, "worker_a", "w1")] }),
        () => ({ content: "done" }),
      ],
      a: [
        () => ({ content: "mid-turn chatter", toolCalls: [{ id: "ga", tool_name: "get_time", arguments: {} }] }),
        () => ({ content: "report A" }),
      ],
      b: [],
    });

    orchestrator.push(makeMessageEvent("chat-16", "go"));
    unwrap(await orchestrator.stepUntilIdle());

    const entry = (await agentRepo.getByChatId("chat-16"))!;
    expect(JSON.parse(toolResultOf(entry, "w1")!)).toBe("report A");
    expect(calls["entry"]).toBe(3);
  });

  it("reaches idle with an open Wait — the loop stops without a response and without re-prompting", async () => {
    const { orchestrator, agentRepo, calls } = await harness({
      entry: [
        (agents) => ({ toolCalls: [waitOf(agents, "worker_a", "w1")] }),
      ],
      a: [],
      b: [],
    });

    // A Sub-agent from a previous run: nothing pending for it, so the queue drains
    // while the Creator is still waiting.
    const sub = Agent.create(workerATemplate);
    await agentRepo.add(sub);

    orchestrator.push(makeMessageEvent("chat-15", "go"));
    unwrap(await orchestrator.stepUntilIdle());

    const entry = (await agentRepo.getByChatId("chat-15"))!;
    expect(orchestrator.empty()).toBe(true);
    expect(openWait(entry.history, sub.id)).toBeDefined();
    expect(toolResultOf(entry, "w1")).toBeUndefined();
    expect(calls["entry"]).toBe(1);
  });

  it("survives a restart: on restore the open Wait is resolved against the Report that arrived while down", async () => {
    // Persisted state at the moment the program stopped: an open Wait on the
    // Creator, a Report already ended by the Sub-agent. Nothing but history.
    const agentRepo = new InMemoryAgentRepository();
    const sub = Agent.deserialize({
      id: "sub-1",
      template: workerATemplate,
      history: [
        { role: "system", content: text("WORKER_A") },
        { role: "assistant", content: "report A" },
      ],
      createdByAgentId: "entry-1",
    });
    const entry = Agent.deserialize({
      id: "entry-1",
      template: entryTemplate,
      history: [
        { role: "system", content: text("ENTRY") },
        { role: "assistant", content: "", tool_calls: [waitOf([sub], "worker_a", "w1")] },
      ],
      waitingForToolCallCount: 1,
    });
    await agentRepo.add(sub);
    await agentRepo.setEntryAgent("chat-17", entry);

    // A fresh orchestrator is the restart; open Waits are resolved before other processing.
    const { orchestrator, calls } = await harness(
      { entry: [() => ({ content: "got it" })], a: [], b: [] },
      agentRepo,
    );
    await orchestrator.resolveOpenWaits();
    unwrap(await orchestrator.stepUntilIdle());

    const restored = (await agentRepo.getByChatId("chat-17"))!;
    expect(openWait(restored.history, sub.id)).toBeUndefined();
    expect(JSON.parse(toolResultOf(restored, "w1")!)).toBe("report A");
    expect(calls["entry"]).toBe(1); // the Creator is re-prompted once with the Report
  });
});
