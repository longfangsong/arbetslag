import { Tool } from "./tool";
import { Context } from "./context";
import { Session } from "./session";

export interface AIProvider {
  name: string;
  sendMessage: (
    context: Context,
    session: Session,
    agentId: string,
    model: string,
    systemPrompt: string,
    message: string,
    tools: Tool<any, any>[]
  ) => Promise<string>;
}
