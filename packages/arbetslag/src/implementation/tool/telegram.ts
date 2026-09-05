import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const SendTelegramMessageInputSchema = z
	.object({
		chat_id: z.string().describe("Telegram chat ID to send the message to."),
		text: z.string().describe("Message text to send."),
	})
	.describe("Send a message to Telegram using the Bot API.");

export class SendTelegramMessage
	implements Tool<z.infer<typeof SendTelegramMessageInputSchema>, { message_id: number }, string>
{
	private readonly token: string;

	name: string = "send_telegram_message";
	description: string =
		"Send a message to Telegram using the Bot API.";
	inputSchema = SendTelegramMessageInputSchema;

	constructor(token: string) {
		this.token = token;
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof SendTelegramMessageInputSchema>,
	): Promise<Result<{ message_id: number }, string>> {
		const response = await fetch(
			`https://api.telegram.org/bot${this.token}/sendMessage`,
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
			return err(`Telegram API error: ${JSON.stringify(data)}`);
		}

		if (!data.result) {
			return err(
				`Telegram API does not return a result: ${JSON.stringify(data)}`,
			);
		}

		return ok({ message_id: data.result.message_id });
	}
}
