import { nanoid } from "nanoid";
import { EventBus } from "./event/bus";
import {
  Event,
  ToolCallRequest,
  MessageEvent,
  ToolResponseEvent,
  AgentMessageEvent,
  ApiCallbackEvent,
  LLMCompletionRequest,
  LLMCompletionResponse,
  AgentOutput,
} from "./event/event";
import { Agent } from "./agent/model";
import { FileSystem } from "./file/model";
import type { Repository as AgentRepository } from "./agent/repository";
import type { Repository as TemplateRepository } from "./agent/template/repository";
import type { Repository as ToolRepository } from "./tool/repository";
import type { Repository as AIProviderRepository } from "./aiProvider/repository";
import type { OutputRouter } from "./outputRouter/model";

export interface OrchestratorDeps {
  fileSystem: FileSystem;
  agentRepository: AgentRepository;
  templateRepository: TemplateRepository;
  toolRepository: ToolRepository;
  aiProviderRepository: AIProviderRepository;
  outputRouter: OutputRouter | null;
}

export class Orchestrator {
  private readonly bus = new EventBus();

  constructor(private readonly deps: OrchestratorDeps) {}

  push(event: Event) {
    this.bus.push(event);
  }

  empty(): boolean {
    return this.bus.empty();
  }

  async step(): Promise<void> {
    const event = this.bus.pop();
    if (!event) return;
    const newEvents = await this.dispatch(event);
    for (const e of newEvents) {
      this.bus.push(e);
    }
  }

  async stepUntilIdle(maxIterations = 1024): Promise<void> {
    let iterations = 0;
    while (!this.bus.empty() && iterations < maxIterations) {
      await this.step();
      iterations++;
    }
  }

  private async dispatch(event: Event): Promise<Array<Event>> {
    const {
      agentRepository,
      templateRepository,
      toolRepository,
      aiProviderRepository,
      fileSystem,
      outputRouter,
    } = this.deps;

    switch (event.event_type) {
      case "message": {
        const e = event as MessageEvent;
        let agent = await agentRepository.getByChatId(e.chat_id);
        if (!agent) {
          const template = await templateRepository.default();
          agent = Agent.create(template);
          agent.chatId = e.chat_id;
          await agentRepository.setEntryAgent(e.chat_id, agent);
        }
        const events = agent.handleMessage(e);
        await agentRepository.save(agent);
        return events;
      }

      case "api_callback": {
        const e = event as ApiCallbackEvent;
        const agent = await agentRepository.getById(e.to_agent_id!);
        const events = agent?.handleApiCallback(e);
        if (agent) await agentRepository.save(agent);
        return events ?? [];
      }

      case "tool_call_request": {
        const e = event as ToolCallRequest;
        const tool = await toolRepository.getByName(e.tool_call.tool_name);
        const agent = await agentRepository.getById(e.from_agent_id);
        const result = await tool?.call(
          { fileSystem },
          agent!,
          e.tool_call.arguments,
        );
        const content =
          result === undefined
            ? "Tool not found"
            : result.isOk()
              ? JSON.stringify(result.value)
              : JSON.stringify(result.error);
        return [
          {
            id: nanoid(10),
            event_type: "tool_call_response" as const,
            to_agent_id: agent!.id,
            tool_call_id: e.tool_call.id,
            name: tool!.name,
            content,
          },
        ];
      }

      case "tool_call_response": {
        const e = event as ToolResponseEvent;
        const agent = await agentRepository.getById(e.to_agent_id);
        const events = agent?.handleToolResponse(e);
        if (agent) await agentRepository.save(agent);
        return events ?? [];
      }

      case "agent_message": {
        const e = event as AgentMessageEvent;
        const agent = await agentRepository.getById(e.to_agent_id);
        const events = agent?.handleAgentMessage(e);
        if (agent) await agentRepository.save(agent);
        return events ?? [];
      }

      case "llm_completion_request": {
        const e = event as LLMCompletionRequest;
        const agent = await agentRepository.getById(e.from_agent_id);
        const aiProvider = await aiProviderRepository.getByName(
          agent!.template.ai_provider,
        );
        const completion = await aiProvider?.complete(
          agent!.template.model,
          e.history,
          toolRepository.getByNames(agent!.template.allowedTools),
        );
        return [
          {
            id: nanoid(10),
            event_type: "llm_completion_response" as const,
            to_agent_id: agent!.id,
            content: completion!.content,
            tool_calls: completion!.tool_calls,
          },
        ];
      }

      case "llm_completion_response": {
        const e = event as LLMCompletionResponse;
        const agent = await agentRepository.getById(e.to_agent_id);
        const events = agent?.handleLLMCompletionResponse(e);
        if (agent) await agentRepository.save(agent);
        return events ?? [];
      }

      case "agent_output": {
        const e = event as AgentOutput;
        if (outputRouter) await outputRouter.route(e);
        return [];
      }
    }
  }
}
