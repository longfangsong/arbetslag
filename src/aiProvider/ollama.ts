import ollama from "ollama";
import { AIProvider } from "@/model/aiProvider";
import { Tool } from "@/model/tool";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Tool as OllamaTool } from "ollama";
import { Context } from "@/model/context";

export class OllamaAIProvider implements AIProvider {
    name: string;

    constructor(name: string, model: string, endpoint: string = "http://localhost:11434") {
        this.name = name;
    }

    async sendMessage(
        context: Context,
        model: string,
        systemPrompt: string,
        message: string,
        tools: Array<Tool<any, any>>
    ): Promise<string> {
        const toolDefinitions = tools.map(tool => {
            // Use the built-in toJSONSchema method from Zod for complete schemas
            const schema = (tool.inputSchema as any).toJSONSchema ? 
                (tool.inputSchema as any).toJSONSchema() : 
                zodToJsonSchema(tool.inputSchema);
            
            return {
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: schema,
                },
            };
        }) as Array<OllamaTool>;
        
        // Build initial messages
        const messages: any[] = [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: message}
        ];
        
        // Agentic loop - continue until no more tool calls (with max iterations for safety)
        const maxIterations = 10;
        let iteration = 0;
        
        while (iteration < maxIterations) {
            iteration++;
            
            const response = await ollama.chat({
                model: model,
                messages: messages,
                stream: false,
                tools: toolDefinitions,
            });
            console.log(`Ollama response (iteration ${iteration}):`, response);
            messages.push({role: 'assistant', content: response.message.content});
            // Check if tool calls were made
            if (response.message.tool_calls && response.message.tool_calls.length > 0) {
                const toolResults: string[] = [];
                const toolMap = new Map(tools.map(t => [t.name, t]));
                
                for (const toolCall of response.message.tool_calls) {
                    const toolName = toolCall.function.name;
                    const tool = toolMap.get(toolName);
                    
                    if (!tool) {
                        toolResults.push(`Error: Tool '${toolName}' not found`);
                        continue;
                    }
                    
                    try {
                        // Parse arguments - they might be a string or already an object
                        let args = toolCall.function.arguments;
                        if (typeof args === 'string') {
                            args = JSON.parse(args);
                        }
                        console.log(`Executing tool '${toolName}' with args:`, args);
                        const result = await tool.handler(context, args);
                        console.log(`Result from tool '${toolName}' with args ${JSON.stringify(args)}:`, result);
                        toolResults.push(`Tool '${toolName}' executed successfully: ${JSON.stringify(result)}`);
                    } catch (error) {
                        toolResults.push(`Error executing tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                
                // Add tool results to messages for the next iteration
                messages.push({
                    role: 'tool',
                    content: toolResults.join('\n'),
                });
                
                // Continue the loop to get the next response from the model
            } else {
                // No more tool calls, return the final response
                return response.message.content;
            }
        }
        
        // Max iterations reached
        return "Conversation ended: Maximum iterations reached";
    };
}