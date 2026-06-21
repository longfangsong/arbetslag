import { dispatchEvent, OutputRouter } from "./event/dispatcher";
import { EventBus } from "./event/bus";
import { MessageEvent } from "./event/event";
import { FileSystemAgentRepository } from "@/implementation/agent/repository";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";
import { InMemoryAIProviderRepository } from "@/implementation/aiProvider/inMemory";
import { OpenAIProvider } from "@/implementation/aiProvider/openai";
import { Telegram } from "@/implementation/outputRouter/telegram";
import { InMemoryToolRepository } from "@/implementation/tool/inMemory";
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

export async function eventLoop(
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
    console.log(`[eventLoop] iteration=${iterations} queue=[${eventBus.queue.map(e => `${e.event_type}(id=${e.id})`).join(", ")}]`);
    const event = eventBus.pop();
    console.log(`[eventLoop] popped: ${event?.event_type}(id=${event?.id})`);
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
    console.log(`[eventLoop] dispatch returned ${newEvents?.length ?? 0} events`);
    if (newEvents) {
      for (const e of newEvents) {
        console.log(`[eventLoop] pushing: ${e.event_type}(id=${e.id})`);
        eventBus.push(e);
      }
    }
    console.log(`[eventLoop] queue now: [${eventBus.queue.map(e => `${e.event_type}(id=${e.id})`).join(", ")}]`);
    iterations++;
  }
}

export interface ArbetslagConfig {
  fileSystem: FileSystem;
  directories?: {
    agents?: string;
    templates?: string;
  };
  openai: { apiKey: string; baseUrl?: string };
  telegram: { botToken: string; apiBase?: string };
  customTools?: Array<Tool<unknown, unknown, unknown>>;
}

export async function processEvent(
  event: MessageEvent,
  config: ArbetslagConfig,
): Promise<void> {
  const { fileSystem, directories, customTools } = config;

  const agentRepo = await FileSystemAgentRepository.create(
    fileSystem,
    directories?.agents ?? "agents/",
  );
  const templateRepo = await FileSystemTemplateRepository.create(
    fileSystem,
    directories?.templates ?? "config/templates/",
  );
  const toolRepo = new InMemoryToolRepository([
    ...createBuiltInTools(),
    ...(customTools ?? []),
  ]);
  const aiProviderRepo = new InMemoryAIProviderRepository([
    new OpenAIProvider(config.openai.apiKey, config.openai.baseUrl),
  ]);

  const outputRouter =
    event.adapter === "telegram"
      ? new Telegram(
          config.telegram.botToken,
          event.chat_id,
          config.telegram.apiBase,
        )
      : null;

  const eventBus = new EventBus();
  eventBus.push(event);

  await eventLoop(
    fileSystem,
    agentRepo,
    templateRepo,
    toolRepo,
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
