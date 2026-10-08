import { Result } from "neverthrow";
import z from "zod";

export interface Tool<I, S, O, E> {
	name: string;
	description: string;
	inputSchema: z.ZodType<I>;
	call(
		state: S,
		input: I,
	): Promise<Result<O, E>>;
}