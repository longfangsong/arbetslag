import { z } from "zod";
import { Result, ok } from "neverthrow";
import { Context } from "../context";
import { Tool } from ".";

export const GetTimeInputSchema = z
  .object({})
  .describe("No input required to get the current time.");

export class GetTime implements Tool<typeof GetTimeInputSchema, string> {
  static toolName: string = "getTime";
  description: string = "Get the current date and time.";
  inputSchema = GetTimeInputSchema;

  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof GetTimeInputSchema>,
  ): Promise<Result<string, string>> {
    return ok(new Date().toString());
  }
}
