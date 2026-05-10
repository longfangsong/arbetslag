import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Context } from "../context";
import { Tool } from ".";

export const SendEmailInputSchema = z
  .object({
    to: z.string().describe("Recipient email address."),
    subject: z.string().describe("Email subject line."),
    body: z.string().describe("Email body content (plain text)."),
  })
  .describe("Send an email using a configured email API.");

export class SendEmail implements Tool<typeof SendEmailInputSchema, { messageId?: string }, string> {
  static toolName: string = "sendEmail";
  description =
    "Send an email using a configured email API. Requires an email_api_url and email_api_key in context config.";
  inputSchema = SendEmailInputSchema;

  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof SendEmailInputSchema>,
  ): Promise<Result<{ messageId?: string }, string>> {
    const apiUrl = context.config?.email_api_url;
    const apiKey = context.config?.email_api_key;

    if (!apiUrl) {
      return err(
        "Email API URL not found in context config. Provide 'email_api_url' when creating Context.",
      );
    }
    if (!apiKey) {
      return err(
        "Email API key not found in context config. Provide 'email_api_key' when creating Context.",
      );
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        body: input.body,
      }),
    });

    const data = (await response.json()) as {
      messageId?: string;
      error?: string;
    };

    if (data.error) {
      return err(`Email API error: ${data.error}`);
    }

    return ok({ messageId: data.messageId });
  }
}
