import type z from "zod";
import { Actor } from "../actor";

export interface ToolMetadata {
    name: string;
    description: string;
    inputSchema: z.ZodType<unknown>
}

export interface ToolCallRequest<I> {
  id: string;
  input: I;
}

export interface ToolCallResponse<O> {
  id: string;
  output: O;
}

export abstract class Tool<I, O> extends Actor<ToolCallRequest<I>, ToolCallResponse<O>> {
  abstract description: string;
  abstract inputSchema: z.ZodType<I>;

  abstract call(input: I): Promise<O>;

  async process(input: ToolCallRequest<I>): Promise<void> {
    const output = await this.call(input.input);
    await this.outputChannel.send({ id: input.id, output });
  }

  public metadata(): ToolMetadata {
    return {
      name: this.id,
      description: this.description,
      inputSchema: this.inputSchema
    };
  }
}
