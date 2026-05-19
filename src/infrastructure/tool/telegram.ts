import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool } from "@/domain/tool/model";
import { State } from "@/application/orchestrator";
import { Agent } from "@/domain/agent/model";

export const SendTelegramMessageInputSchema = z
	.object({
		chat_id: z.string().describe("Telegram chat ID to send the message to."),
		text: z.string().describe("Message text to send."),
	})
	.describe("Send a message to Telegram using the Bot API.");

export class SendTelegramMessage
	implements
		Tool<
			z.infer<typeof SendTelegramMessageInputSchema>,
			{ message_id: number },
			string
		>
{
	name: string = "sendTelegramMessage";

	description: string =
		"Send a message to Telegram using the Bot API. Requires a telegram_bot_token in context config.";
	inputSchema = SendTelegramMessageInputSchema;

	async call(
		state: State,
		caller: Agent,
		input: z.infer<typeof SendTelegramMessageInputSchema>,
	): Promise<Result<{ message_id: number }, string>> {
		const token = state.config["telegram_bot_token"];
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
