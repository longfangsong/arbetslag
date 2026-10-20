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
  readonly kind = "tool" as const;

  abstract description: string;
  abstract inputSchema: z.ZodType<I>;

  abstract call(input: I): Promise<O>;

  async process(input: ToolCallRequest<I>): Promise<ReadonlyArray<ToolCallResponse<O>>> {
    const output = await this.call(input.input);
    return [{ id: input.id, output }];
  }

  public metadata(): ToolMetadata {
    return {
      name: this.id,
      description: this.description,
      inputSchema: this.inputSchema
    };
  }
}
