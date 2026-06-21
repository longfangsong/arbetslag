import { Result } from "neverthrow";
import z from "zod";
import { Agent } from "../agent/model";
import { FileSystem } from "../filesystem/model";

export interface ToolExecutingContext {
	fileSystem: FileSystem;
}

export interface Tool<I, O, E> {
	name: string;
	description: string;
	inputSchema: z.ZodType<I>;
	call(
		context: ToolExecutingContext,
		caller: Agent,
		input: I,
	): Promise<Result<O, E>>;
}
