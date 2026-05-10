import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Context } from "../context";
import { Tool } from ".";

export const SendSlackMessageInputSchema = z
  .object({
    channel: z.string().describe("Slack channel ID or name to send the message to."),
    text: z.string().describe("Message text to send."),
  })
  .describe("Send a message to Slack using the Web API.");

export class SendSlackMessage implements Tool<typeof SendSlackMessageInputSchema, { channel?: string; ts?: string }, string> {
  static toolName: string = "sendSlackMessage";
  description =
    "Send a message to Slack using the Web API. Requires a slack_bot_token in context config.";
  inputSchema = SendSlackMessageInputSchema;

  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof SendSlackMessageInputSchema>,
  ): Promise<Result<{ channel?: string; ts?: string }, string>> {
    const token = context.config?.slack_bot_token;
    if (!token) {
      return err(
        "Slack bot token not found in context config. Provide 'slack_bot_token' when creating Context.",
      );
    }

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: input.channel,
        text: input.text,
      }),
    });

    const data = (await response.json()) as {
      ok: boolean;
      channel?: string;
      ts?: string;
      error?: string;
    };

    if (!data.ok) {
      return err(`Slack API error: ${data.error ?? "Unknown error"}`);
    }

    return ok({ channel: data.channel, ts: data.ts });
  }
}
