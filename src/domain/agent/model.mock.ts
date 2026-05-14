import { Agent } from "./model";
import { Template } from "./template/model";

export function createMockAgent(template?: Partial<Template>): Agent {
    const t: Template = {
        name: template?.name ?? "mock",
        description: template?.description ?? "",
        ai_provider: template?.ai_provider ?? "",
        model: template?.model ?? "",
        systemPrompt: template?.systemPrompt ?? "",
        allowedTools: template?.allowedTools ?? [],
    };
    return new Agent(t);
}
