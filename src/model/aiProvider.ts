import { Tool } from "./tool";
import { Context } from "./context";

export interface AIProvider {
  name: string;
  sendMessage: (
    context: Context,
    model: string,
    systemPrompt: string,
    message: string,
    tools: Tool<any, any>[]) => Promise<string>;
}
