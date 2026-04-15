import ollama, { Message } from "ollama";
import { AIProvider } from "@/model/aiProvider";
import { Tool } from "@/model/tool";
import { Tool as OllamaTool } from "ollama";
import { Context } from "@/model/context";
import { Session } from "@/model/session";
import { z } from "zod";


export class OllamaAIProvider implements AIProvider {
    name: string;

    constructor(name: string, endpoint: string = "http://localhost:11434") {
        this.name = name;
    }

    async sendMessage(
        context: Context,
        session: Session,
        agentId: string,
        model: string,
        systemPrompt: string,
        message: string,
        tools: Array<Tool<any, any>>
    ): Promise<string> {
        const toolDefinitions = tools.map(tool => {            
            return {
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: z.toJSONSchema(tool.inputSchema),
                },
            };
        }) as Array<OllamaTool>;

        const messages: Message[] = [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: message}
        ];
        
        const maxIterations = 128;
        let iteration = 0;
        while (iteration < maxIterations) {
            iteration++;
            const response = await ollama.chat({
                model: model,
                messages: messages,
                stream: false,
                tools: toolDefinitions,
            });
            messages.push(response.message);
            // Check if tool calls were made
            if (response.message.tool_calls && response.message.tool_calls.length > 0) {
                for (const toolCall of response.message.tool_calls) {
                    let toolResult: any;
                    const toolName = toolCall.function.name;
                    const tool = tools.find(it => it.name === toolName);                    
                    try {
                        // Parse arguments - they might be a string or already an object
                        let args = toolCall.function.arguments;
                        toolResult = await tool?.handler(context, session, args);
                    } catch (error) {
                        toolResult = `Error executing tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`;
                    }
                    messages.push({
                        role: 'tool',
                        tool_name: tool?.name || "unknown_tool",
                        content: JSON.stringify(toolResult),
                    });
                }
                // Continue the loop to get the next response from the model
            } else {
                // No more tool calls, return the final response
                session.recordMessages(agentId, messages);
                return response.message.content;
            }
        }
        
        // Max iterations reached
        return "Conversation ended: Maximum iterations reached";
    };
}