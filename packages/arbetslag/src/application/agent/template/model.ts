export interface Template {
	/// name of the template, used for identification and selection
	name: string;
	/// description of the template, used for display and selection
	description: string;
	/// which ai provider should agent created with this template use
	ai_provider: string;
	/// which model should agent created with this template use
	model: string;
	/// system prompt for the agent, can be a string or a function that returns a string
	systemPrompt: string;
	/// tools this agent is allowed to use
	allowedTools: string[];
	/// output schema for the agent, JSON schema format, note: some providers does not support tool call + output schema
	outputSchema?: Record<string, unknown>;
	/// Compact when the metered request size reaches this many estimated tokens. Default: 32768.
	compactThreshold?: number;
	/// Rounds kept untouched by compaction. Default: 4.
	compactRetainRounds?: number;
	/// Override the LLM-based compaction summary prompt. Default: built-in English prompt.
	compactSummaryPrompt?: string;
}
