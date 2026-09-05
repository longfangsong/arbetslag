import { describe, it, expect } from "vitest";
import { Orchestrator } from "./orchestrator";
import { MessageEvent } from "./event/event";
import { InMemoryFileSystem } from "@/implementation/tool/file/filesystem/inMemory";
import { FileSystemAgentRepository } from "@/implementation/agent/repository";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";
import { InMemoryAIProviderRepository } from "@/implementation/aiProvider/inMemory";
import { ReadFile } from "@/implementation/tool/file/readFile";
import { WriteFile } from "@/implementation/tool/file/writeFile";
import { EditFile } from "@/implementation/tool/file/editFile";
import { DeleteFile } from "@/implementation/tool/file/deleteFile";
import { ListFiles } from "@/implementation/tool/file/listFiles";
import { HttpRequest } from "@/implementation/tool/http";
import { GetTime } from "@/implementation/tool/getTime";
import type { AIProvider } from "./aiProvider/model";
import type { Template } from "@/application/agent/template/model";
import type { OutputRouter } from "./outputRouter/model";

const sampleTemplate: Template = {
  name: "test",
  description: "A test template",
  ai_provider: "openai",
  model: "gpt-4",
  systemPrompt: "You are a test agent.",
  allowedTools: [],
};

function makeMessageEvent(chatId: string, content: string): MessageEvent {
  return {
    id: "evt-001",
    event_type: "message",
    chat_id: chatId,
    adapter: "telegram",
    content,
  };
}

function makeBuiltInTools() {
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

function makeToolRepo() {
  const tools = makeBuiltInTools();
  return {
    get tools() {
      return tools;
    },
    async getByName(name: string) {
      return tools.find((t) => t.name === name) ?? null;
    },
    getByNames(names: string[]) {
      return tools.filter((t) => names.includes(t.name));
    },
  };
}

function makeAiRepo(provider: AIProvider) {
  return new InMemoryAIProviderRepository([provider]);
}

function mockAiProvider(): AIProvider {
  return {
    name: "openai",
    async complete() {
      return {
        role: "assistant",
        content: "Hello from mock AI",
        tool_calls: [],
      };
    },
  };
}

describe("event_loop", () => {
  it("processes events until idle", async () => {
    const fs = new InMemoryFileSystem();
    const agentRepo = await FileSystemAgentRepository.create(
      fs,
      "test-agents/",
    );
    const templateRepo = await FileSystemTemplateRepository.create(
      fs,
      "test-templates/",
    );

    await templateRepo.add(sampleTemplate);

    const aiRepo = makeAiRepo(mockAiProvider());
    const outputRouter: OutputRouter = { async route() {} };

    const orchestrator = new Orchestrator({
      fileSystem: fs,
      agentRepository: agentRepo,
      templateRepository: templateRepo,
      toolRepository: makeToolRepo(),
      aiProviderRepository: aiRepo,
      outputRouter,
    });
    orchestrator.push(makeMessageEvent("chat-1", "Hi"));
    await orchestrator.stepUntilIdle();

    expect(orchestrator.empty()).toBe(true);

    const list = await agentRepo.list();
    expect(list).toHaveLength(1);
    expect(list[0].chatId).toBe("chat-1");
    expect(list[0].history).toHaveLength(2);
    expect(list[0].history[0]).toEqual({ role: "user", content: "Hi" });
    expect(list[0].history[1]).toEqual({
      role: "assistant",
      content: "Hello from mock AI",
      tool_calls: [],
    });
  });

  it("handles multiple events across calls", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "test-templates/test.json",
      JSON.stringify(sampleTemplate),
    );

    const aiRepo = makeAiRepo(mockAiProvider());

    // First call
    {
      const orchestrator = new Orchestrator({
        fileSystem: fs,
        agentRepository: await FileSystemAgentRepository.create(
          fs,
          "test-agents/",
        ),
        templateRepository: await FileSystemTemplateRepository.create(
          fs,
          "test-templates/",
        ),
        toolRepository: makeToolRepo(),
        aiProviderRepository: aiRepo,
        outputRouter: null,
      });
      orchestrator.push(makeMessageEvent("chat-x", "First"));
      await orchestrator.stepUntilIdle();
    }

    // Second call (reuses same agent from fs)
    {
      const orchestrator = new Orchestrator({
        fileSystem: fs,
        agentRepository: await FileSystemAgentRepository.create(
          fs,
          "test-agents/",
        ),
        templateRepository: await FileSystemTemplateRepository.create(
          fs,
          "test-templates/",
        ),
        toolRepository: makeToolRepo(),
        aiProviderRepository: aiRepo,
        outputRouter: null,
      });
      orchestrator.push(makeMessageEvent("chat-x", "Second"));
      await orchestrator.stepUntilIdle();
    }

    const agentRepo = await FileSystemAgentRepository.create(
      fs,
      "test-agents/",
    );
    const agents = await agentRepo.list();
    expect(agents).toHaveLength(1);
    expect(agents[0].history).toHaveLength(4);
    expect(agents[0].history[0].content).toBe("First");
    expect(agents[0].history[1]).toEqual({
      role: "assistant",
      content: "Hello from mock AI",
      tool_calls: [],
    });
    expect(agents[0].history[2]).toEqual({ role: "user", content: "Second" });
    expect(agents[0].history[3]).toEqual({
      role: "assistant",
      content: "Hello from mock AI",
      tool_calls: [],
    });
  });
});
