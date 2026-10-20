import type z from "zod";
import { Actor } from "../actor";
import { nodeName } from "../utils";

export interface ToolMetadata {
    name: string;
    description: string;
    inputSchema: z.ZodType<unknown>
}

/**
 * One tool call, as the model issued it.
 *
 * `id` is the model's correlation handle for *this call* — it goes back out with
 * the response so the history can pair them up. It is not a node identity.
 */
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

  /** The model sees `name`, so it is derived from the class rather than minted. */
  public metadata(): ToolMetadata {
    return {
      name: nodeName(this),
      description: this.description,
      inputSchema: this.inputSchema
    };
  }
}
