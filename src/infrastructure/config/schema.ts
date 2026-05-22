import { z } from "zod";

const TemplateSchema = z.object({
	name: z.string(),
	description: z.string(),
	ai_provider: z.string(),
	model: z.string(),
	systemPrompt: z.string(),
	allowedTools: z.array(z.string()),
});

export const configSchema = z
	.object({
		providers: z.array(z.string()).optional(),
		tools: z.array(z.string()).optional(),
		templates: z.array(TemplateSchema).optional(),
		config: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();
