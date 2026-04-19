import { Agent } from "../agent";
import { Context } from "../context";
import { Session } from "../session";
import { Tool } from "../tool";

export interface ToolCall {
  id: string;
  function: { name: string; arguments: unknown };
}

export interface AssistantMessage {
  role?: string;
  content?: string | unknown[];
  tool_calls?: ToolCall[];
}

export abstract class AIProvider {
  abstract name: string;

  protected abstract buildToolDefinitions(tools: Array<Tool<any, any>>): unknown;

  protected abstract createInitialMessages(systemPrompt: string, message: string): unknown[];

  protected abstract requestNextResponse(model: string, messages: unknown[], toolDefinitions: unknown): Promise<unknown>;

  protected abstract parseResponse(response: unknown): AssistantMessage | undefined;

  protected abstract isFunctionToolCall(toolCall: unknown): boolean;

  protected abstract getToolName(toolCall: unknown): string;

  protected abstract getToolArguments(toolCall: unknown): unknown;

  protected abstract createToolMessage(toolCall: ToolCall, toolResult: unknown): unknown;

  protected abstract extractFinalContent(assistantMessage: AssistantMessage): string;

  protected abstract parseToolArguments<T = unknown>(tool: Tool<any, any>, rawArguments: unknown): T;

  private async callTool(
    context: Context,
    session: Session,
    agent: Agent,
    toolCall: ToolCall,
  ): Promise<unknown | undefined> {
    if (!this.isFunctionToolCall(toolCall)) {
      return undefined;
    }

    const toolName = this.getToolName(toolCall);
    const tool = agent.tools.find((candidate) => (candidate.constructor as { name: string }).name === toolName);

    try {
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found.`);
      }

      const args = this.parseToolArguments(tool, this.getToolArguments(toolCall));
      return await tool.handler(context, session, args);
    } catch (error) {
      return `Error executing tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  public async sendMessage(
    context: Context,
    session: Session,
    agent: Agent,
    message: string,
  ): Promise<string> {
    const toolDefinitions = this.buildToolDefinitions(agent.tools);
    const messages = this.createInitialMessages(agent.template.systemPrompt, message);

    let iteration = 0;
    while (iteration < 128) {
      iteration++;

      const response = await this.requestNextResponse(agent.template.model, messages, toolDefinitions);
      const assistantMessage = this.parseResponse(response);

      if (!assistantMessage) {
        throw new Error(`${this.name} provider returned no assistant message.`);
      }
      messages.push(assistantMessage);

      const toolCalls = assistantMessage.tool_calls ?? [];
      for (const toolCall of toolCalls) {
        const toolResult = await this.callTool(context, session, agent, toolCall);
        if (toolResult !== undefined) {
          messages.push(this.createToolMessage(toolCall, toolResult));
        }
      }
      await session.recordMessages(agent.id, messages, context.fileSystem);
      if (toolCalls.length === 0) {
        return this.extractFinalContent(assistantMessage);
      }
    }

    return "Conversation ended: Maximum iterations reached";
  }
}
