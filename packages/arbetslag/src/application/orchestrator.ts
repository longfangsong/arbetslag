import { z } from "zod";
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
  CompactRequest,
} from "./event/event";
import { Agent } from "./agent/model";
import {
  type CompactResult,
  compactAgent,
  estimateHistoryTokens,
  estimateTokens,
  formatCompactNotice,
  NOTHING_TO_COMPACT,
  DEFAULT_COMPACT_THRESHOLD,
  DEFAULT_COMPACT_RETAIN_ROUNDS,
} from "./agent/compact";
import { FileSystem } from "./file/model";
import type { Repository as AgentRepository } from "./agent/repository";
import type { Repository as TemplateRepository } from "./agent/template/repository";
import type { Repository as ToolRepository } from "./tool/repository";
import type { Repository as AIProviderRepository } from "./aiProvider/repository";
import type { AIProvider } from "./aiProvider/model";
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

  private notifyCompact(result: CompactResult): Promise<void> {
    return this.deps.outputRouter
      ? this.deps.outputRouter.route({
          kind: "history_compacted",
          content: result.compacted
            ? formatCompactNotice(result.beforeTokens, result.afterTokens)
            : NOTHING_TO_COMPACT,
          beforeTokens: result.compacted ? result.beforeTokens : undefined,
          afterTokens: result.compacted ? result.afterTokens : undefined,
        })
      : Promise.resolve();
  }

  /**
   * Compact the agent's history before an LLM request if the metered size
   * crosses the template threshold. Metering: anchor (last real
   * prompt_tokens + estimated delta) when available, full estimation
   * otherwise (ADR-0001). Notifies the user only when something was compacted.
   */
  private async compactIfNeeded(
    agent: Agent,
    provider: AIProvider | null,
  ): Promise<void> {
    const { agentRepository } = this.deps;
    const template = agent.template;
    const threshold =
      template.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD;
    const retainRounds =
      template.compactRetainRounds ?? DEFAULT_COMPACT_RETAIN_ROUNDS;
    // Anchor branch: the anchor's prompt already covered history up to (but
    // not including) the last assistant entry, so meter that entry plus all
    // newer ones. Derived rather than stored: every LLM call appends exactly
    // one assistant entry (agent messages are stored as user-role entries).
    let anchorCursor = 0;
    for (let i = agent.history.length - 1; i >= 0; i--) {
      if (agent.history[i].role === "assistant") {
        anchorCursor = i;
        break;
      }
    }
    const meteredTokens =
      agent.lastPromptTokens != null
        ? agent.lastPromptTokens + estimateHistoryTokens(agent.history.slice(anchorCursor))
        : estimateTokens(template.systemPrompt) +
          estimateHistoryTokens(agent.history);
    if (meteredTokens < threshold) return;
    const result = await compactAgent({
      agent,
      provider,
      threshold,
      retainRounds,
      summaryPrompt: template.compactSummaryPrompt,
    });
    await agentRepository.save(agent);
    if (result.compacted) {
      await this.notifyCompact(result);
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
        const template = agent!.template;
        const aiProvider = await aiProviderRepository.getByName(
          template.ai_provider,
        );
        await this.compactIfNeeded(agent!, aiProvider);
        const outputSchema = template.outputSchema
          ? z.fromJSONSchema(template.outputSchema)
          : undefined;
        const completion = await aiProvider?.complete(
          template.model,
          agent!.history,
          toolRepository.getByNames(template.allowedTools),
          outputSchema,
        );
        return [
          {
            id: nanoid(10),
            event_type: "llm_completion_response" as const,
            to_agent_id: agent!.id,
            content: completion!.content,
            tool_calls: completion!.tool_calls,
            usage: completion!.usage,
          },
        ];
      }

      case "compact_request": {
        const e = event as CompactRequest;
        let agent = await agentRepository.getByChatId(e.chat_id);
        if (!agent) {
          // First message in the chat is /compact: create the agent the same
          // way the "message" flow does, then compact (empty history ->
          // nothing to compact, but the agent now exists for the user).
          const template = await templateRepository.default();
          agent = Agent.create(template);
          agent.chatId = e.chat_id;
          await agentRepository.setEntryAgent(e.chat_id, agent);
        }
        const result = await compactAgent({
          agent,
          provider: await aiProviderRepository.getByName(
            agent.template.ai_provider,
          ),
          threshold:
            agent.template.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD,
          retainRounds:
            agent.template.compactRetainRounds ??
            DEFAULT_COMPACT_RETAIN_ROUNDS,
          summaryPrompt: agent.template.compactSummaryPrompt,
        });
        await agentRepository.save(agent);
        await this.notifyCompact(result);
        return [];
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
