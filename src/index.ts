import { Orchestrator } from "./application/orchestrator";
import type { OrchestratorDeps } from "./application/orchestrator";
import { MessageEvent } from "./application/event/event";
import { FileSystemAgentRepository } from "@/implementation/agent/repository";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";
import { InMemoryAIProviderRepository } from "@/implementation/aiProvider/inMemory";
import { OpenAIProvider } from "@/implementation/aiProvider/openai";
import { Telegram } from "@/implementation/outputRouter/telegram";
import { InMemoryToolRepository } from "@/implementation/tool/repository";
import { ReadFile } from "@/implementation/tool/file/readFile";
import { WriteFile } from "@/implementation/tool/file/writeFile";
import { EditFile } from "@/implementation/tool/file/editFile";
import { DeleteFile } from "@/implementation/tool/file/deleteFile";
import { ListFiles } from "@/implementation/tool/file/listFiles";
import { HttpRequest } from "@/implementation/tool/http";
import { GetTime } from "@/implementation/tool/getTime";
import {
	ListEntities,
	CreateEntity,
	GetEntity,
	PatchEntity,
	DeleteEntity,
	CreateRelationship,
	GetRelationship,
	GetEntityRelationships,
} from "@/implementation/tool/ontology";
import type { OntologyConfig } from "@/implementation/tool/ontology";
import type { Tool } from "./application/tool/model";
import type { FileSystem } from "./application/file/model";

export {
	Orchestrator,
	ListEntities,
	CreateEntity,
	GetEntity,
	PatchEntity,
	DeleteEntity,
	CreateRelationship,
	GetRelationship,
	GetEntityRelationships,
};
export type { OrchestratorDeps, OntologyConfig };

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
  const orchestrator = new Orchestrator({
    fileSystem: config.fileSystem,
    agentRepository: await FileSystemAgentRepository.create(
      config.fileSystem,
      config.directories?.agents ?? "agents/",
    ),
    templateRepository: await FileSystemTemplateRepository.create(
      config.fileSystem,
      config.directories?.templates ?? "config/templates/",
    ),
    toolRepository: new InMemoryToolRepository([
      ...createBuiltInTools(),
      ...(config.customTools ?? []),
    ]),
    aiProviderRepository: new InMemoryAIProviderRepository([
      new OpenAIProvider(config.openai.apiKey, config.openai.baseUrl),
    ]),
    outputRouter:
      event.adapter === "telegram"
        ? new Telegram(
            config.telegram.botToken,
            event.chat_id,
            config.telegram.apiBase,
          )
        : null,
  });

  orchestrator.push(event);
  await orchestrator.stepUntilIdle();
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
