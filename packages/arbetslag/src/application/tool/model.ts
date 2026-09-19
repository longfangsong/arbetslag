import { Result } from "neverthrow";
import z from "zod";
import { Agent } from "../agent/model";
import { FileSystem } from "../file/model";
import { Event } from "../event/event";

export interface ToolExecutingContext {
	fileSystem: FileSystem;
	/** Queue an event for a later step — processed after this tool's own response. */
	pushEvent: (event: Event) => void;
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
