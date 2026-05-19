import { State } from "@/application/orchestrator";
import { Result } from "neverthrow";
import z from "zod";
import { Agent } from "../agent/model";

export interface Tool<I, O, E> {
	name: string;
	description: string;
	inputSchema: z.ZodType<I>;
	call(state: State, caller: Agent, input: I): Promise<Result<O, E>>;
}
