import { Result } from "neverthrow";
import z from "zod";
import { Agent } from "../agent/model";
import { FileSystem } from "../file/model";
import { Repository as AgentRepository } from "../agent/repository";
import { Repository as TemplateRepository } from "../agent/template/repository";
import { EventBus } from "../event/bus";

export interface ToolExecutingContext {
	fileSystem: FileSystem;
	bus: EventBus;
	agentRepository: AgentRepository;
	templateRepository: TemplateRepository,
	toolState: Record<string, unknown>;
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
