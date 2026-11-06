import type { JsonValue } from "type-fest";
import { z } from "zod";

export const messageSchema = z.object({
	id: z.string().min(1),
	from: z.string().min(1),
	type: z.string().min(1),
}).catchall(z.json() as z.ZodType<JsonValue>);

export type Message = z.infer<typeof messageSchema>;
