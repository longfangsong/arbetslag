import { Orchestrator } from "./application/orchestrator";
import type { OrchestratorDeps } from "./application/orchestrator";
export type { Result } from "neverthrow";
import { MessageEvent } from "./application/event/event";
import { contentText, text } from "./application/agent/history";
import { FileSystemAgentRepository } from "@/implementation/agent/repository/fileSystem";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";
import { InMemoryAIProviderRepository } from "@/implementation/aiProvider/inMemory";
import { OpenAIProvider } from "@/implementation/aiProvider/openai";
import { Telegram } from "@/implementation/outputRouter/telegram";
import { OutputRouterRegistry } from "./application/outputRouter/registry";
import { InMemoryToolRepository } from "@/implementation/tool/repository";
import { FileSystemToolStateRepository } from "@/implementation/tool/state";
import { ReadFile } from "@/implementation/tool/file/readFile";
import { WriteFile } from "@/implementation/tool/file/writeFile";
import { EditFile } from "@/implementation/tool/file/editFile";
import { DeleteFile } from "@/implementation/tool/file/deleteFile";
import { ListFiles } from "@/implementation/tool/file/listFiles";
import { ListTemplates } from "@/implementation/tool/subagent/listTemplates";
import { HttpRequest } from "@/implementation/tool/http";
import { FetchWebPage } from "@/implementation/tool/fetchWebPage";
import { GetTime } from "@/implementation/tool/getTime";
import { CronCreate } from "@/implementation/tool/cron/create";
import { CronDelete } from "@/implementation/tool/cron/delete";
import { WebSearch } from "@/implementation/tool/webSearch";
import { SimpleMemoryRead, SimpleMemoryUpdate } from "@/implementation/tool/memory"; import type { Tool } from "./application/tool/model";
import type { FileSystem } from "./application/file/model";

export {
  Orchestrator,
  // Infrastructure re-exported for library consumers (e.g. the telegram-bot app).
  FileSystemAgentRepository,
  FileSystemTemplateRepository,
  FileSystemToolStateRepository,
};
export { TelegramInputAdopter } from "./implementation/inputAdopter/telegram";
export { InMemoryFileSystem } from "./implementation/tool/file/filesystem/inMemory";
export { NodeFileSystem } from "./implementation/tool/file/filesystem/nodeFs";
export { OpenAIProvider } from "./implementation/aiProvider/openai";
export { InMemoryAIProviderRepository } from "./implementation/aiProvider/inMemory";
export { InMemoryToolRepository } from "./implementation/tool/repository";
export { GetTime } from "./implementation/tool/getTime";
export { ReadFile } from "./implementation/tool/file/readFile";
export { WriteFile } from "./implementation/tool/file/writeFile";
export { EditFile } from "./implementation/tool/file/editFile";
export { DeleteFile } from "./implementation/tool/file/deleteFile";
export { ListFiles } from "./implementation/tool/file/listFiles";
export { ListTemplates } from "./implementation/tool/subagent/listTemplates";
export { SpawnAgent } from "./implementation/tool/subagent/spawn";
export { CronCreate } from "./implementation/tool/cron/create";
export { CronDelete } from "./implementation/tool/cron/delete";
export { HttpRequest } from "./implementation/tool/http";
export { FetchWebPage } from "./implementation/tool/fetchWebPage";
export { WebSearch } from "./implementation/tool/webSearch";
export { SimpleMemoryRead, SimpleMemoryUpdate } from "./implementation/tool/memory";
export { MEMORY_FILE } from "./implementation/tool/memory";
export type { Tool } from "./application/tool/model";
export type { ToolStateRepository } from "./application/tool/state";
export type { Agent } from "./application/agent/model";
export type { MessageEvent, ApiCallbackEvent, CompactRequest, AgentOutput } from "./application/event/event";
export type { ContentPart, Content } from "./application/agent/history";
export { contentText, text } from "./application/agent/history";
export type { FileSystem } from "./application/file/model";
export type { Template } from "./application/agent/template/model";
export type { OutputRouter, OutputEvent, Compacted, SerializedOutputRouter } from "./application/outputRouter/model";
export { OutputRouterRegistry } from "./application/outputRouter/registry";
export type { OrchestratorDeps };
export type { Update } from "./implementation/inputAdopter/telegram";

export interface ArbetslagConfig {
  fileSystem: FileSystem;
  directories?: {
    agents?: string;
    templates?: string;
    toolState?: string;
  };
  openai: { apiKey: string; baseUrl?: string };
  telegram: { botToken: string; apiBase?: string };
  webSearch?: { searxngUrl: string; timeoutMs?: number; maxResults?: number };
  customTools?: Array<Tool<unknown, unknown, unknown>>;
}

export async function processEvent(
  event: MessageEvent,
  config: ArbetslagConfig,
): Promise<void> {
  const outputRouterRegistry = new OutputRouterRegistry([
    [
      "telegram",
      (
        data: Record<string, unknown>,
      ) =>
        new Telegram(
          config.telegram.botToken,
          data.chatId as string,
          data.apiBase as string | undefined,
        ),
    ],
  ]);
  const orchestrator = new Orchestrator({
    fileSystem: config.fileSystem,
    agentRepository: await FileSystemAgentRepository.create(
      config.fileSystem,
      outputRouterRegistry,
      config.directories?.agents ?? "agents/",
    ),
    templateRepository: await FileSystemTemplateRepository.create(
      config.fileSystem,
      config.directories?.templates ?? "config/templates/",
    ),
    toolRepository: new InMemoryToolRepository([
      ...createBuiltInTools(config.webSearch),
      ...(config.customTools ?? []),
    ]),
    toolState: new FileSystemToolStateRepository(
      config.fileSystem,
      config.directories?.toolState ?? "tool_state/",
    ),
    aiProviderRepository: new InMemoryAIProviderRepository([
      new OpenAIProvider(config.openai.apiKey, config.openai.baseUrl),
    ]),
    outputRouterRegistry,
  });

  orchestrator.push(event);
  await orchestrator.stepUntilIdle();
}

function createBuiltInTools(
  webSearchConfig?: ArbetslagConfig["webSearch"],
): Array<Tool<unknown, unknown, unknown>> {
  return [
    new ReadFile(),
    new WriteFile(),
    new EditFile(),
    new DeleteFile(),
    new ListFiles(),
    new ListTemplates(),
    new HttpRequest(),
    new FetchWebPage(),
    new GetTime(),
    ...(webSearchConfig
      ? [
        new WebSearch(
          webSearchConfig.searxngUrl,
          webSearchConfig.timeoutMs,
          webSearchConfig.maxResults,
        ),
      ]
      : []),
  ];
}
