import { BaseProvider, AssistantMessage, ToolCall } from "./aiProvider";
import { Tool, ok } from "./tool";
import { Result } from "neverthrow";
import { z } from "zod";
import { Context } from "./context";

/**
 * Minimal LLMAdapter for testing — returns pre-configured responses.
 */
export class MockLLMAdapter extends BaseProvider {
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

/**
 * A minimal Tool for testing.
 */
export class MockTool extends Tool<z.ZodTypeAny, string> {
  static readonly toolName: string = "mockTool";
  description = "A mock tool for testing.";
  inputSchema = z.object({});

  handler = async (
    _context: Context,
    _agentId: string,
    _input: unknown,
  ): Promise<Result<string, string>> => {
    return ok("mock result");
  };
}

// Export the constructor for use in tests
export const mockToolCtor = MockTool;
