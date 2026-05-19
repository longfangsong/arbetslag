import { State } from "@/application/orchestrator";
import { Agent } from "@/domain/agent/model";
import { UserOutputHandler } from "@/domain/outputHandler/model";

export class TelegramOutputHandler extends UserOutputHandler {
	private botToken: string;

	constructor(adapter: string, chatId: string, botToken: string) {
		super(adapter, chatId);
		this.botToken = botToken;
	}

	async handle(state: State, _agent: Agent, content: string): Promise<State> {
		const response = await fetch(
			`https://api.telegram.org/bot${this.botToken}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					chat_id: this.chat_id,
					text: content,
				}),
			},
		);

		const data = (await response.json()) as {
			ok: boolean;
			description?: string;
		};

		if (!data.ok) {
			throw new Error(
				`Telegram API error: ${data.description ?? JSON.stringify(data)}`,
			);
		}

		return state;
	}
}
