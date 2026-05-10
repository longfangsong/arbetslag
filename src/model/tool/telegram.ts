import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Context } from "../context";
import { Tool } from ".";

export const SendTelegramMessageInputSchema = z
  .object({
    chat_id: z.string().describe("Telegram chat ID to send the message to."),
    text: z.string().describe("Message text to send."),
  })
  .describe("Send a message to Telegram using the Bot API.");

export class SendTelegramMessage implements Tool<typeof SendTelegramMessageInputSchema, { result?: { message_id: number } }, string> {
  static readonly toolName: string = "sendTelegramMessage";
  
  description: string =
    "Send a message to Telegram using the Bot API. Requires a telegram_bot_token in context config.";
  inputSchema = SendTelegramMessageInputSchema;

  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof SendTelegramMessageInputSchema>,
  ): Promise<Result<{ result?: { message_id: number } }, string>> {
    const token = context.config?.telegram_bot_token;
    if (!token) {
      return err(
        "Telegram bot token not found in context config. Provide 'telegram_bot_token' when creating Context.",
      );
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: input.chat_id,
          text: input.text,
        }),
      },
    );

    const data = (await response.json()) as {
      ok: boolean;
      result?: { message_id: number };
    };

    if (!data.ok) {
      return err(
        `Telegram API error: ${JSON.stringify(data)}`,
      );
    }

    return ok({ result: data.result });
  }
}
