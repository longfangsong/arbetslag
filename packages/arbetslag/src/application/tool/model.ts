import { Result } from "neverthrow";
import z from "zod";
import { Agent } from "../agent/model";
import { FileSystem } from "../file/model";
import { EventBus } from "../event/bus";
import { Repository as AgentRepository } from "../agent/repository";
import { Repository as TemplateRepository } from "../agent/template/repository";
import { ToolStateRepository } from "./state";

export interface ToolExecutingContext {
	fileSystem: FileSystem;
	agentRepository: AgentRepository;
	templateRepository: TemplateRepository;
	eventBus: EventBus;
	toolState: ToolStateRepository;
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
