import { Tool } from "../tool";

export interface ToolCall {
  id: string;
  function: { name: string; arguments: unknown };
}

export interface AssistantMessage {
  role?: string;
  content?: string | unknown[];
  tool_calls?: ToolCall[];
}

export interface LLMAdapter {
  name: string;
  /** Build tool definitions for this provider's format. */
  buildToolDefs(tools: Array<Tool<any, any, string>>): unknown;
  /** Make one API call, return the assistant message. */
  call(messages: unknown[], toolDefs: unknown, model: string): Promise<AssistantMessage>;
  /** Create a tool-result message for this provider's format. */
  createToolMessage(toolCall: ToolCall, result: unknown): unknown;
  /** Get the tool name from a tool call. */
  getToolName(toolCall: ToolCall): string;
  /** Get the raw arguments from a tool call. */
  getToolArguments(toolCall: ToolCall): unknown;
  /** Parse raw arguments against a tool's input schema. */
  parseToolArguments<T = unknown>(tool: Tool<any, any, string>, rawArguments: unknown): T;
}

export abstract class BaseProvider implements LLMAdapter {
  abstract name: string;
  abstract buildToolDefs(tools: Array<Tool<any, any, string>>): unknown;
  abstract call(messages: unknown[], toolDefs: unknown, model: string): Promise<AssistantMessage>;
  abstract createToolMessage(toolCall: ToolCall, result: unknown): unknown;

  /** Get the tool name from a tool call. */
  getToolName(toolCall: ToolCall): string {
    return (toolCall as { function: { name: string } }).function.name;
  }

  /** Get the raw arguments from a tool call. */
  getToolArguments(toolCall: ToolCall): unknown {
    return (toolCall as { function: { arguments: unknown } }).function.arguments;
  }

  /** Parse raw arguments against a tool's input schema. */
  parseToolArguments<T = unknown>(tool: Tool<any, any, string>, rawArguments: unknown): T {
    if (rawArguments === undefined || rawArguments === null) {
      return tool.inputSchema.parse({}) as T;
    }
    if (typeof rawArguments === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawArguments);
      } catch {
        throw new Error(`Invalid JSON in tool arguments: ${rawArguments}`);
      }
      return tool.inputSchema.parse(parsed) as T;
    }
    return tool.inputSchema.parse(rawArguments) as T;
  }
}
