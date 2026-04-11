import { ToolCall, ToolResult } from '../types';
import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
}

export class ToolValidator {
  static validateArguments(schema: z.ZodObject<any>, argumentsJson: string): z.infer<z.ZodObject<any>> {
    const args = JSON.parse(argumentsJson);
    return schema.parse(args);
  }
}

export class ToolExecutor {
  constructor(private tools: Map<string, (args: any) => Promise<any>>) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    const toolFn = this.tools.get(call.name);
    if (!toolFn) {
     throw new Error(`Tool ${call.name} not found`);
    }

    try {
      const args = JSON.parse(call.arguments);
      const result = await toolFn(args);
      return {
        toolCallId: call.id,
        content: JSON.stringify(result),
      };
    } catch (error: any) {
      return {
        toolCallId: call.id,
        content: error.message,
        error: error.message,
      };
    }
  }
}
