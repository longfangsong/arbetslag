import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryFileSystem } from "./fileSystem/inMemory";
import { InMemoryAgentRepository } from "./agentRepository";
import { createRuntime, type Context } from "./context";
import type { Template } from "./agent";
import { BaseProvider, AssistantMessage, ToolCall } from "./aiProvider";
import { Tool } from "./tool";
import { SubscriptionRegistry } from "./subscriptionRegistry";

// ── Mock LLM Adapter ─────────────────────────────────────────────────────────

class MockLLMAdapter extends BaseProvider {
  name: string;
  private _response: { content?: string; toolCalls?: ToolCall[] } | null;

  constructor(name: string) {
    super();
    this.name = name;
    this._response = null;
  }

  setResponse(content: string): void {
    this._response = { content };
  }

  setToolCalls(calls: ToolCall[]): void {
    this._response = { toolCalls: calls };
  }

  public buildToolDefs(_tools: Array<Tool<any, any, string>>): unknown {
    return [];
  }

  public async call(
    messages: unknown[],
    _toolDefs: unknown,
    _model: string,
  ): Promise<AssistantMessage> {
    const response = await this.requestNextResponse(_model, messages, []);
    return this.parseResponse(response) ?? {
      role: "assistant",
      content: `${this.name} adapter returned no assistant message.`,
    };
  }

  public createToolMessage(
    toolCall: ToolCall,
    toolResult: unknown,
  ): unknown {
    return {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(toolResult),
    };
  }

  private async requestNextResponse(
    _model: string,
    _messages: unknown[],
    _toolDefinitions: unknown,
  ): Promise<unknown> {
    if (this._response?.toolCalls) {
      return {
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: this._response.toolCalls,
            },
          },
        ],
      };
    }
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: this._response?.content ?? "done",
          },
        },
      ],
    };
  }

  private parseResponse(response: unknown): {
    role?: string;
    content?: string;
    tool_calls?: ToolCall[];
  } | undefined {
    const choices = (response as { choices?: unknown[] })?.choices;
    if (!choices?.length) return undefined;
    const msg = (choices[0] as { message?: unknown })?.message as
      | { role?: string; content?: string; tool_calls?: ToolCall[] }
      | undefined;
    if (!msg) return undefined;
    return msg;
  }
}

// ── Integration Tests ────────────────────────────────────────────────────────

describe("Integration: actor-based event loop", () => {
  let fs: InMemoryFileSystem;
  let mockAdapter: MockLLMAdapter;
  let repo: InMemoryAgentRepository;
  let context: Context;
  let agentRunner: import("./agentRunner").AgentRunner;

  const defaultTemplate: Template = {
    name: "default-agent",
    description: "Default agent for integration tests",
    provider: "mock",
    model: "mock-model",
    systemPrompt: "You are a test agent.",
    tools: [],
    isDefault: true,
  };

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    mockAdapter = new MockLLMAdapter("mock");
    repo = new InMemoryAgentRepository();
    const runtime = createRuntime(
      [mockAdapter],
      [],
      fs,
      [defaultTemplate],
      {},
      repo,
    );
    context = runtime.context;
    agentRunner = runtime.agentRunner;
  });

  it("default agent is created on first message", async () => {
    mockAdapter.setResponse("Hello from default agent");

    await agentRunner.handleMessage({
      content: "Hello",
    });

    // Verify default agent ID was persisted
    const defaultId = await fs.readFile("run/_default_agent_id.json");
    expect(defaultId).toBeDefined();
  });

  it("default agent persists state across calls", async () => {
    mockAdapter.setResponse("First response");
    await agentRunner.handleMessage({ content: "First" });

    mockAdapter.setResponse("Second response");
    await agentRunner.handleMessage({ content: "Second" });

    // Both messages should go to the same agent
    const defaultId = await fs.readFile("run/_default_agent_id.json");
    const agent = await repo.load(defaultId, context);
    expect(agent).not.toBeNull();
    expect(agent!.history.length).toBe(4); // 2 user + 2 assistant
  });

  it("emitEvent routes to subscribed agent", async () => {
    const reg = new SubscriptionRegistry(fs);
    await reg.subscribe("user:message", "agent-1");

    mockAdapter.setResponse("Got it");

    const agent = await repo.create(defaultTemplate, context);
    await agentRunner.handleMessage({
      agentId: agent.id,
      content: "Start",
    });

    const count = await agentRunner.emitEvent("user:message", "Hello!");
    expect(count).toBe(1);

    // Verify message was enqueued to mailbox
    const mailboxContent = await fs.readFile("mailbox/agent-1.json");
    const messages = JSON.parse(mailboxContent) as Array<{ content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello!");
  });

  it("spawn creates and processes agent", async () => {
    const workerTemplate: Template = {
      name: "worker",
      description: "Worker agent",
      provider: "mock",
      model: "mock-model",
      systemPrompt: "You are a worker.",
      tools: [],
    };
    context.agentTemplates.push(workerTemplate);

    mockAdapter.setResponse("Spawned agent done");

    const agentId = await agentRunner.spawn("worker", "Do the work");
    expect(typeof agentId).toBe("string");

    const agent = await repo.load(agentId, context);
    expect(agent).not.toBeNull();
    expect(agent!.history.length).toBe(2); // user + assistant
  });
});
