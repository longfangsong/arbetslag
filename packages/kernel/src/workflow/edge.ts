import { z } from "zod";

export const schema = z.object({
	from: z.string().min(1),
	type: z.string().min(1),
	to: z.union([
		z.literal("effect"),
		z.literal("broadcast"),
		z.array(z.string().min(1))
	]),
});

export type Edge = z.infer<typeof schema>;