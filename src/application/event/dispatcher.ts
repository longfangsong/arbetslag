import { nanoid } from "nanoid";
import { Agent } from "../agent/model";
import { Repository as AgentRepository } from "../agent/repository";
import { Repository as TemplateRepository } from "../agent/template/repository";
import { FileSystem } from "../filesystem/model";
import { Repository as AIProviderRepository } from "../aiProvider/repository";
import { Repository as ToolRepository } from "../tool/repository";
import {
    Event,
    ToolCallRequest,
    MessageEvent,
    ToolResponseEvent,
    AgentMessageEvent,
    ApiCallbackEvent as APICallbackEvent,
    LLMCompletionRequest,
    LLMCompletionResponse,
    AgentOutput,
} from "./event";
import { Err } from "neverthrow";
import { OutputRouter } from "../outputRouter/model";

export type { OutputRouter } from "../outputRouter/model";

export async function dispatchEvent(
    fileSystem: FileSystem,
    agentRepository: AgentRepository,
    templateRepository: TemplateRepository,
    toolRepository: ToolRepository,
    aiProviderRepository: AIProviderRepository,
    outputRouter: OutputRouter | null,
    event: Event
): Promise<Array<Event> | void> {
    console.log(`[dispatch] event_type=${event.event_type}, id=${event.id}`);
    switch (event.event_type) {
        case "message": {
            let message_event = event as MessageEvent;
            console.log(`[dispatch/message] chat_id=${message_event.chat_id}, content="${message_event.content}"`);
            let agent = await agentRepository.getByChatId(message_event.chat_id);
            if (!agent) {
                console.log(`[dispatch/message] New agent created for chat ${message_event.chat_id}`);
                const template = await templateRepository.default();
                console.log(`[dispatch/message] Template: name=${template?.name}, model=${template?.model}, ai_provider=${template?.ai_provider}`);
                agent = Agent.create(template);
                agent.chatId = message_event.chat_id;
                await agentRepository.setEntryAgent(message_event.chat_id, agent);
            }
            agent.setPersistContext(fileSystem, agentRepository.dir);
            return await agent.handleMessage(message_event);
        }
        case "api_callback": {
            let api_callback_event = event as APICallbackEvent;
            const agent = await agentRepository.getById(api_callback_event.to_agent_id!);
            agent?.setPersistContext(fileSystem, agentRepository.dir);
            return await agent?.handleApiCallback(api_callback_event);
        }
        case "tool_call_request": {
            let tool_call_event = event as ToolCallRequest;
            const tool = await toolRepository.getByName(tool_call_event.tool_call.tool_name);
            const agent = await agentRepository.getById(tool_call_event.from_agent_id);
            agent?.setPersistContext(fileSystem, agentRepository.dir);
            const result = await tool?.call({ fileSystem }, agent!, tool_call_event.tool_call.arguments);
            const content = result === undefined ? "Tool not found" : (
                result?.isOk() ? JSON.stringify(result.value) :
                JSON.stringify((result as Err<unknown, unknown>).error)
            );
            await dispatchEvent(fileSystem, agentRepository, templateRepository, toolRepository, aiProviderRepository, outputRouter, {
                id: nanoid(10),
                event_type: "tool_call_response",
                to_agent_id: agent!.id,
                tool_call_id: tool_call_event.tool_call.id,
                name: tool!.name,
                content,
            });
            return;
        }
        case "tool_call_response": {
            let tool_call_response_event = event as ToolResponseEvent;
            const agent = await agentRepository.getById(tool_call_response_event.to_agent_id);
            agent?.setPersistContext(fileSystem, agentRepository.dir);
            return await agent?.handleToolResponse(tool_call_response_event);
        }
        case "agent_message": {
            let agent_message_event = event as AgentMessageEvent;
            const agent = await agentRepository.getById(agent_message_event.to_agent_id);
            agent?.setPersistContext(fileSystem, agentRepository.dir);
            return await agent?.handleAgentMessage(agent_message_event);
        }
        case "llm_completion_request": {
            let llm_completion_request_event = event as LLMCompletionRequest;
            const agent = await agentRepository.getById(llm_completion_request_event.from_agent_id);
            agent?.setPersistContext(fileSystem, agentRepository.dir);
            const aiProvider = await aiProviderRepository.getByName(agent!.template.ai_provider);
            console.log(`[dispatch/llm] agent=${agent?.id}, provider=${agent?.template.ai_provider}, model=${agent?.template.model}, history_len=${llm_completion_request_event.history.length}`);
            console.log(`[dispatch/llm] history:`, JSON.stringify(llm_completion_request_event.history, null, 2).slice(0, 500));
            const completion_result = await aiProvider?.complete(agent!.template.model, llm_completion_request_event.history, toolRepository.tools);
            console.log(`[dispatch/llm] completion_result: content_len=${completion_result?.content?.length ?? 0}, tool_calls=${completion_result?.tool_calls?.length ?? 0}`);
            return dispatchEvent(fileSystem, agentRepository, templateRepository, toolRepository, aiProviderRepository, outputRouter,  {
                id: nanoid(10),
                event_type: "llm_completion_response",
                to_agent_id: agent!.id,
                content: completion_result!.content,
                tool_calls: completion_result!.tool_calls,
            });
        }
        case "llm_completion_response": {
            let llm_completion_response_event = event as LLMCompletionResponse;
            const agent = await agentRepository.getById(llm_completion_response_event.to_agent_id);
            agent?.setPersistContext(fileSystem, agentRepository.dir);
            return await agent?.handleLLMCompletionResponse(llm_completion_response_event);
        }
        case "agent_output": {
            let agent_output_event = event as AgentOutput;
            if (outputRouter) {
                console.log(`[dispatch/output] agent=${agent_output_event.from_agent_id}, content_len=${agent_output_event.content?.length ?? 0}`);
                await outputRouter.route(agent_output_event);
            } else {
                console.log(`[dispatch/output] ⚠️ No output router, dropping message`);
            }
            return;
        }
    }
}