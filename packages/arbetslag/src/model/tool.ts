import z from "zod";
import { Event, Reducer } from "..";

export interface ToolCallRequestEvent<I> extends Event {
    type: string;
	id: string;
	callerId: string;
	input: I;
}

export interface ToolCallDoneEvent<O> extends Event {
	type: string;
	id: string;
	callerId: string;
	output: O;
}

export interface Tool<I> extends Reducer<ToolCallRequestEvent<I>> {
	id: string;
	description: string;
	inputSchema: z.ZodType<I>;
}
