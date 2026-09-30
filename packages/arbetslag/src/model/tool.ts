import z from "zod";
import { Agent } from "./agent";
import { State } from "./state";
import { Result } from "neverthrow";

export interface Tool<I, O, E> {
	id: string;
	description: string;
	inputSchema: z.ZodType<I>;
	call(
		context: State,
		caller: Agent,
		input: I,
	): Promise<Result<O, E>>;
}
