import { dispatchEvent, OutputRouter } from "./event/dispatcher";
import { EventBus } from "./event/bus";
import { MessageEvent } from "./event/event";
import { FileSystemAgentRepository } from "@/implementation/agent/repository";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";
import { InMemoryAIProviderRepository } from "@/implementation/aiProvider/inMemory";
import { ReadFile } from "@/implementation/tool/readFile";
import { WriteFile } from "@/implementation/tool/writeFile";
import { EditFile } from "@/implementation/tool/editFile";
import { DeleteFile } from "@/implementation/tool/deleteFile";
import { ListFiles } from "@/implementation/tool/listFiles";
import { HttpRequest } from "@/implementation/tool/http";
import { GetTime } from "@/implementation/tool/getTime";
import type { AIProvider } from "./aiProvider/model";
import type { Tool } from "./tool/model";
import type { FileSystem } from "./filesystem/model";
import type { Repository as AgentRepository } from "./agent/repository";
import type { Repository as TemplateRepository } from "./agent/template/repository";
import type { Repository as ToolRepository } from "./tool/repository";
import type { Repository as AIProviderRepository } from "./aiProvider/repository";

export async function event_loop(
    fileSystem: FileSystem,
    agentRepository: AgentRepository,
    templateRepository: TemplateRepository,
    toolRepository: ToolRepository,
    aiProviderRepository: AIProviderRepository,
    outputRouter: OutputRouter | null,
    eventBus: EventBus,
    maxIterations: number = 1024,
): Promise<void> {
    let iterations = 0;
    while (!eventBus.empty() && iterations < maxIterations) {
        const event = eventBus.pop();
        if (!event) continue;
        const newEvents = await dispatchEvent(
            fileSystem,
            agentRepository,
            templateRepository,
            toolRepository,
            aiProviderRepository,
            outputRouter,
            event,
        );
        if (newEvents) {
            for (const e of newEvents) {
                eventBus.push(e);
            }
        }
        iterations++;
    }
}

export interface ArbetslagConfig {
	fileSystem: FileSystem;
	directories?: {
		agents?: string;
		templates?: string;
	};
	createProviders: (fs: FileSystem) => Promise<Map<string, AIProvider>>;
	customTools?: Array<Tool<unknown, unknown, unknown>>;
	createOutputRouter: (adapter: string) => OutputRouter | null;
}

export async function processEvent(
	event: MessageEvent,
	config: ArbetslagConfig,
): Promise<void> {
	const { fileSystem, directories, createProviders, customTools, createOutputRouter } = config;

	const agentRepo = await FileSystemAgentRepository.create(fileSystem, directories?.agents ?? "agents/");
	const templateRepo = await FileSystemTemplateRepository.create(fileSystem, directories?.templates ?? "config/templates/");

	const providerMap = await createProviders(fileSystem);
	const aiProviderRepo = new InMemoryAIProviderRepository();
	for (const [name, provider] of providerMap) {
		await aiProviderRepo.register(provider);
	}

	const builtins = createBuiltInTools();
	const allTools = [...builtins, ...(customTools ?? [])];
	const combinedTools = new (class {
		get tools(): Array<Tool<unknown, unknown, unknown>> {
			return allTools;
		}
		async getByName(name: string): Promise<Tool<unknown, unknown, unknown> | null> {
			return allTools.find(t => t.name === name) ?? null;
		}
		getByNames(names: string[]): Array<Tool<unknown, unknown, unknown>> {
			return allTools.filter(t => names.includes(t.name));
		}
	})();

	const outputRouter = createOutputRouter(event.adapter);

	const eventBus = new EventBus();
	eventBus.push(event);

	await event_loop(
		fileSystem,
		agentRepo,
		templateRepo,
		combinedTools,
		aiProviderRepo,
		outputRouter,
		eventBus,
	);

	await fileSystem.writeFile(
		`${directories?.agents ?? "agents/"}chat_map.json`,
		JSON.stringify(Object.fromEntries(agentRepo.chatMap)),
	);
}

function createBuiltInTools(): Array<Tool<unknown, unknown, unknown>> {
	return [
		new ReadFile(),
		new WriteFile(),
		new EditFile(),
		new DeleteFile(),
		new ListFiles(),
		new HttpRequest(),
		new GetTime(),
	];
}
