import { z } from "zod";
import { Context } from "../context";
import { Session } from "../session";
import { Tool } from ".";

export const GetTimeInputSchema = z
  .object({})
  .describe("No input required to get the current time.");

export class GetTime implements Tool<typeof GetTimeInputSchema, string> {
  static name: string = "getTime";
  description: string = "Get the current date and time.";
  inputSchema = GetTimeInputSchema;

  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof GetTimeInputSchema>,
  ): Promise<string> {
    return new Date().toString();
  }
}
