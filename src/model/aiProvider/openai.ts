import OpenAI from "openai";
import {
  type ChatCompletionMessageParam,
  type ChatCompletionTool,
  type ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import { Tool } from "../tool";
import { z } from "zod";
import { hoursToMilliseconds } from "date-fns";
import { BaseProvider, AssistantMessage, ToolCall } from ".";

export interface OpenAICompatibleProviderOptions {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
  project?: string;
  timeout?: number;
  maxRetries?: number;
}

export class OpenAIProvider extends BaseProvider {
  name: string;
  private client: OpenAI;

  constructor(name: string, options: OpenAICompatibleProviderOptions = {}) {
    super();
    this.name = name;
    this.client = new OpenAI({
      apiKey: options.apiKey ?? "EMPTY",
      baseURL: options.baseURL,
      organization: options.organization,
      project: options.project,
      timeout: options.timeout ?? hoursToMilliseconds(2),
      maxRetries: options.maxRetries ?? 2,
    });
  }

  public buildToolDefs(
    tools: Array<Tool<any, any>>,
  ): ChatCompletionTool[] {
    return tools.map((tool) => {
      const toolName = (tool.constructor as unknown as { toolName: string }).toolName;
      return {
        type: "function",
        function: {
          name: toolName,
          description: tool.description,
          parameters: z.toJSONSchema(tool.inputSchema),
          strict: true,
        },
      };
    });
  }

  public async call(
    messages: unknown[],
    toolDefs: unknown,
    model: string,
  ): Promise<AssistantMessage> {
    const response = await this.client.chat.completions.create({
      model,
      messages: messages as ChatCompletionMessageParam[],
      tools: toolDefs as ChatCompletionTool[],
      tool_choice:
        (toolDefs as ChatCompletionTool[]).length > 0 ? "auto" : "none",
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
    const toolMessage: ChatCompletionToolMessageParam = {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(toolResult),
    };
    return toolMessage;
  }

  private parseResponse(response: unknown): AssistantMessage | undefined {
    const msg = (
      response as {
        choices?: Array<{
          message: { role?: string; content?: unknown; tool_calls?: unknown[] };
        }>;
      }
    ).choices?.[0]?.message;
    if (!msg) return undefined;
    return {
      role: msg.role as string | undefined,
      content: msg.content as string | unknown[],
      tool_calls: msg.tool_calls as ToolCall[],
    };
  }
}
