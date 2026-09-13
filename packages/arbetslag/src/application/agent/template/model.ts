export interface Template {
	name: string;
	description: string;

	ai_provider: string;
	model: string;

	systemPrompt: string;
	allowedTools: string[];
	outputSchema?: Record<string, unknown>;

	/** Compact when the metered request size reaches this many estimated tokens. Default: 32768. */
	compactThreshold?: number;
	/** Rounds kept untouched by compaction. Default: 4. */
	compactRetainRounds?: number;
	/** Override the LLM-based compaction summary prompt. Default: built-in English prompt. */
	compactSummaryPrompt?: string;
}
