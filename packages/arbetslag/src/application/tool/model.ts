import { Result } from "neverthrow";
import z from "zod";
import { Agent } from "../agent/model";
import { FileSystem } from "../file/model";
import { Event } from "../event/event";

export interface ToolExecutingContext {
	fileSystem: FileSystem;
	/** Queue an event for a later step — processed after this tool's own response. */
	pushEvent: (event: Event) => void;
	/**
	 * Create a Sub-agent from a pre-declared Template, hand it the task as its
	 * first message, and return its id — nothing here waits for its work. The
	 * global depth cap is enforced here, not by the caller. Returns an error
	 * string when the Template is unknown or the Creator chain is already at
	 * MAX_AGENT_DEPTH.
	 */
	createAgent: (templateName: string, task: string) => Promise<Result<string, string>>;
	/**
	 * The Report an Agent has produced so far, or undefined when it has not
	 * ended a turn yet — a Wait reads the latest one.
	 */
	getReport: (agentId: string) => Promise<string | undefined>;
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
