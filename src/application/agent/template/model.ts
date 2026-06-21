export interface Template {
	name: string;
	description: string;

	ai_provider: string;
	model: string;

	systemPrompt: string;
	allowedTools: string[];
}
