import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryFileSystem } from "./fileSystem/inMemory";
import { EventRegistry } from "./eventRegistry";
import { Context } from "./context";
import { Session } from "./session";
import { Agent, Template } from "./agent";
import { AwaitEvent } from "./tool/awaitEvent";
import { handleEvent } from "./eventHandler";
import { AIProvider, ToolCall } from "./aiProvider";
import { Tool } from "./tool";

// ── Mock AI Provider ─────────────────────────────────────────────────────────

/**
 * A minimal AIProvider that returns a simple response with no tool calls.
 * Useful for integration tests where we don't want to hit a real LLM.
 */
class MockAIProvider extends AIProvider {
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

  protected buildToolDefinitions(tools: Array<Tool<any, any>>): unknown {
    return [];
  }

  protected createInitialMessages(
    systemPrompt: string,
    message: string,
  ): unknown[] {
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
    ];
  }

  protected async requestNextResponse(
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

  protected parseResponse(response: unknown): {
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

  protected isFunctionToolCall(_toolCall: unknown): boolean {
    return true;
  }

  protected getToolName(toolCall: unknown): string {
    return (toolCall as { function: { name: string } }).function.name;
  }

  protected getToolArguments(toolCall: unknown): unknown {
    return (toolCall as { function: { arguments: unknown } }).function
      .arguments;
  }

  protected createToolMessage(
    toolCall: ToolCall,
    toolResult: unknown,
  ): unknown {
    return {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(toolResult),
    };
  }

  protected extractFinalContent(msg: { content?: string }): string {
    return msg.content ?? "";
  }

  protected parseToolArguments<T = unknown>(
    _tool: Tool<any, any>,
    rawArguments: unknown,
  ): T {
    if (typeof rawArguments === "string") {
      try {
        return JSON.parse(rawArguments) as T;
      } catch {
        return {} as T;
      }
    }
    return (rawArguments ?? {}) as T;
  }
}

// ── Integration Tests ────────────────────────────────────────────────────────

describe("Integration: awaitEvent → handleEvent → resume", () => {
  let fs: InMemoryFileSystem;
  let registry: EventRegistry;
  let mockProvider: MockAIProvider;
  let context: Context;

  const testTemplate: Template = {
    name: "test-agent",
    description: "Test agent for integration tests",
    provider: "mock",
    model: "mock-model",
    systemPrompt: "You are a test agent.",
    tools: [{ name: "awaitEvent" }],
  };

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    registry = new EventRegistry("data/events.json", fs);
    mockProvider = new MockAIProvider("mock");
    context = new Context(
      [mockProvider],
      [AwaitEvent],
      fs,
      [testTemplate],
      {},
      registry,
    );
  });

  it(
    "agent pauses with awaitEvent, handleEvent resumes it",
    async () => {
      // Step 1: Agent calls awaitEvent tool
      const session = new Session({ prompt: "test" });
      const agent = new Agent(context, testTemplate);
      session.currentAgentId = agent.id;

      const awaitEventTool = new AwaitEvent();
      const registerResult = await awaitEventTool.handler(context, session, {
        eventId: "test-event-1",
      });

      expect(registerResult).toEqual({
        eventId: "test-event-1",
        status: "registered",
      });

      // Step 2: Verify event is in registry
      const record = await registry.resolve("test-event-1");
      expect(record).toBeDefined();
      expect(record!.sessionId).toBe(session.id);
      expect(record!.agentId).toBe(agent.id);

      // Step 3: Save agent state to disk (simulating what recordState does)
      await agent.recordState(session.id, [], fs);

      // Step 4: Call handleEvent with a payload
      const payload = {
        eventId: "test-event-1",
        data: { message: "external event received" },
      };

      // Step 5: handleEvent should resume the agent
      // The mock provider returns a simple response with no tool calls,
      // so the loop completes and returns the final content
      mockProvider.setResponse("Agent resumed successfully.");

      const result = await handleEvent(context, payload);

      expect(result).toBe("Agent resumed successfully.");

      // Step 6: Verify event was marked resolved
      const resolved = await registry.resolve("test-event-1");
      expect(resolved).toBeUndefined();
    },
    5000,
  );

  it(
    "handleEvent throws on missing eventId",
    async () => {
      await expect(
        handleEvent(context, { data: "no event id" }),
      ).rejects.toThrow("Missing eventId in payload");
    },
  );

  it(
    "handleEvent throws on unknown eventId",
    async () => {
      await expect(
        handleEvent(context, { eventId: "nonexistent-event" }),
      ).rejects.toThrow("Event 'nonexistent-event' not found in registry");
    },
  );

  it(
    "handleEvent uses payload.data as event message when present",
    async () => {
      // Register an event
      const session = new Session({ prompt: "test" });
      const agent = new Agent(context, testTemplate);
      session.currentAgentId = agent.id;

      const awaitEventTool = new AwaitEvent();
      await awaitEventTool.handler(context, session, {
        eventId: "test-event-2",
      });

      await agent.recordState(session.id, [], fs);

      // Call with data payload
      mockProvider.setResponse("Event: {\"value\":42}");

      const result = await handleEvent(context, {
        eventId: "test-event-2",
        data: { value: 42 },
      });

      expect(result).toBe("Event: {\"value\":42}");
    },
    5000,
  );
});
