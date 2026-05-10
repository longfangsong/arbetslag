import { Ollama, type Message } from "ollama";
import { Tool } from "../tool";
import { Tool as OllamaTool } from "ollama";
import { z } from "zod";
import { BaseProvider, AssistantMessage, ToolCall } from ".";

export interface OllamaProviderOptions {
  baseURL?: string;
}

export class OllamaAIProvider extends BaseProvider {
  name: string;
  private client: Ollama;

  constructor(name: string, options: OllamaProviderOptions = {}) {
    super();
    this.name = name;
    const endpoint = options.baseURL ?? "http://localhost:11434";
    this.client = new Ollama({ host: endpoint });
  }

  public buildToolDefs(tools: Array<Tool<any, any, string>>): unknown {
    return tools.map((tool) => {
      const toolName = (tool.constructor as unknown as { toolName: string }).toolName;
      return {
        type: "function",
        function: {
          name: toolName,
          description: tool.description,
          parameters: z.toJSONSchema(tool.inputSchema),
        },
      };
    }) as unknown;
  }

  public async call(
    messages: unknown[],
    toolDefs: unknown,
    model: string,
  ): Promise<AssistantMessage> {
    const response = await this.client.chat({
      model,
      messages: messages as Message[],
      stream: false,
      tools: toolDefs as Array<OllamaTool>,
    });
    return this.parseResponse(response) ?? {
      role: "assistant",
      content: `${this.name} provider returned no assistant message.`,
    };
  }

  public createToolMessage(
    toolCall: ToolCall,
    toolResult: unknown,
  ): unknown {
    return {
      role: "tool",
      tool_name: toolCall.function.name,
      content: JSON.stringify(toolResult),
    };
  }

  private parseResponse(response: unknown): AssistantMessage | undefined {
    const msg = (
      response as {
        message?: { role?: string; content?: unknown; tool_calls?: unknown[] };
      }
    ).message;
    if (!msg) return undefined;
    return {
      role: msg.role as string | undefined,
      content: msg.content as string | unknown[],
      tool_calls: msg.tool_calls as ToolCall[],
    };
  }
}
