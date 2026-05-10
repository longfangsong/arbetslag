import { describe, it, expect } from "vitest";
import { InMemoryFileSystem } from "./fileSystem/inMemory";
import { InMemoryAgentRepository } from "./agentRepository";
import { createRuntime, type Context } from "./context";
import type { Template } from "./agent";
import type { AgentRunner } from "./agentRunner";
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
    model: string,
  ): Promise<AssistantMessage> {
    const response = await this.requestNextResponse(model, messages, []);
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

// ── Test Helpers ─────────────────────────────────────────────────────────────

function createTestContext(): {
  fs: InMemoryFileSystem;
  mockAdapter: MockLLMAdapter;
  repo: InMemoryAgentRepository;
  context: Context;
  runner: AgentRunner;
} {
  const fs = new InMemoryFileSystem();
  const mockAdapter = new MockLLMAdapter("mock");
  const repo = new InMemoryAgentRepository();

  const templates: Template[] = [
    {
      name: "default",
      description: "Default agent",
      provider: "mock",
      model: "mock-model",
      systemPrompt: "You are a default agent.",
      tools: [],
      isDefault: true,
    },
    {
      name: "worker",
      description: "Worker agent",
      provider: "mock",
      model: "mock-model",
      systemPrompt: "You are a worker agent.",
      tools: [],
    },
  ];

  const runtime = createRuntime(
    [mockAdapter],
    [],
    fs,
    templates,
    {},
    repo,
  );

  return { fs, mockAdapter, repo, context: runtime.context, runner: runtime.agentRunner };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentRunner", () => {
  describe("handleMessage", () => {
    it("creates default agent on first use", async () => {
      const { runner, mockAdapter, fs, repo, context } = createTestContext();

      mockAdapter.setResponse("Hello from default agent");

      await runner.handleMessage({
        content: "Hello",
      });

      // Verify default agent ID was persisted
      const defaultId = await fs.readFile("run/_default_agent_id.json");
      expect(defaultId).toBeDefined();

      // Verify agent was created and has history
      const agent = await repo.load(defaultId, context);
      expect(agent).not.toBeNull();
      expect(agent!.history.length).toBe(2); // user + assistant
    });

    it("reuses default agent across calls", async () => {
      const { runner, mockAdapter, repo, fs, context } = createTestContext();

      mockAdapter.setResponse("First message");
      await runner.handleMessage({ content: "First" });

      mockAdapter.setResponse("Second message");
      await runner.handleMessage({ content: "Second" });

      // Both messages should go to the same agent
      const defaultId = await fs.readFile("run/_default_agent_id.json");
      const agent = await repo.load(defaultId, context);
      expect(agent).not.toBeNull();
      // History: first user + first assistant + second user + second assistant
      // (system prompt is sent to API but not stored in history)
      expect(agent!.history.length).toBe(4);
    });

    it("routes to specific agent ID", async () => {
      const { runner, mockAdapter, repo, context } = createTestContext();

      // Create a specific agent first
      const agent = await repo.create(
        {
          name: "worker",
          description: "Worker",
          provider: "mock",
          model: "mock-model",
          systemPrompt: "You are a worker.",
          tools: [],
        },
        context,
      );

      mockAdapter.setResponse("Worker responded");

      await runner.handleMessage({
        agentId: agent.id,
        content: "Do work",
      });

      const loaded = await repo.load(agent.id, context);
      expect(loaded).not.toBeNull();
      expect(loaded!.history.length).toBe(2);
    });

    it("serializes non-string content as JSON", async () => {
      const { runner, mockAdapter, repo, context } = createTestContext();

      // Create a specific agent
      const agent = await repo.create(
        {
          name: "worker",
          description: "Worker",
          provider: "mock",
          model: "mock-model",
          systemPrompt: "You are a worker.",
          tools: [],
        },
        context,
      );

      mockAdapter.setResponse("Received: payload");

      await runner.handleMessage({
        agentId: agent.id,
        content: { key: "value" },
      });

      const loaded = await repo.load(agent.id, context);
      const history = loaded!.history as Array<{ role: string; content?: string }>;
      const userMsg = history.find(
        (m) => m.role === "user",
      );
      expect(userMsg?.content).toBe('{"key":"value"}');
    });
  });

  describe("emitEvent", () => {
    it("routes to SubscriptionRegistry subscribers", async () => {
      const { runner, fs } = createTestContext();

      // Subscribe agent via subscription registry
      const reg = new SubscriptionRegistry(fs);
      await reg.subscribe("test-event", "agent-123");

      const count = await runner.emitEvent("test-event", { data: "hello" });
      expect(count).toBe(1);

      // Check mailbox
      const mailboxContent = await fs.readFile("mailbox/agent-123.json");
      const messages = JSON.parse(mailboxContent) as Array<{ content: string }>;
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('{"data":"hello"}');
    });

    it("routes to SubscriptionRegistry subscribers", async () => {
      const { runner, fs } = createTestContext();

      // Subscribe agents via subscription registry
      const reg = new SubscriptionRegistry(fs);
      await reg.subscribe("user:message", "agent-a");
      await reg.subscribe("user:message", "agent-b");

      const count = await runner.emitEvent("user:message", "Hello!");
      expect(count).toBe(2);

      const msgA = JSON.parse(await fs.readFile("mailbox/agent-a.json")) as Array<{ content: string }>;
      const msgB = JSON.parse(await fs.readFile("mailbox/agent-b.json")) as Array<{ content: string }>;
      expect(msgA).toHaveLength(1);
      expect(msgB).toHaveLength(1);
      expect(msgA[0].content).toBe("Hello!");
      expect(msgB[0].content).toBe("Hello!");
    });
  });

  describe("spawn", () => {
    it("creates agent and processes first turn", async () => {
      const { runner, mockAdapter, repo, context } = createTestContext();

      mockAdapter.setResponse("Spawned agent done");

      const agentId = await runner.spawn("worker", "Do the work");

      expect(typeof agentId).toBe("string");

      const agent = await repo.load(agentId, context);
      expect(agent).not.toBeNull();
      expect(agent!.history.length).toBe(2); // user, assistant
    });

    it("throws on unknown template", async () => {
      const { runner } = createTestContext();

      await expect(
        runner.spawn("nonexistent", "prompt"),
      ).rejects.toThrow("Template 'nonexistent' not found");
    });
  });
});
