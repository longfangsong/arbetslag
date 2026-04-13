import { AgentTemplate } from "@/model/agent";
import * as afs from "@/tools/filesystem";
import { Spawn } from "@/tools/spawn";
import { ListAgentTemplates } from "@/tools/listAgentTemplates";

export let generalPurposeAgentTemplate: AgentTemplate;

generalPurposeAgentTemplate = {
    name: "generalPurposeAgent",
    description: "A general purpose agent that can handle various tasks using the provided tools.",
    provider: "ollama",
    model: "gemma4:26b",
    systemPrompt: `You are a helpful assistant that can use the provided tools to accomplish various tasks. 
    Always try to use the tools when necessary to get accurate information or perform actions.
    You should always output with correct filed, with \`tool_calls\` field if you want to call tools, and wait for the tool results before answering the user.`,
    tools: [
        new afs.Write(),
        new afs.Read(),
        new afs.Replace(),
        new afs.List(),
        new afs.Delete(),
    ],
};

// Initialize tools that need access to agentTemplates after template is defined
generalPurposeAgentTemplate.tools.push(
    new ListAgentTemplates({
        agentTemplates: [generalPurposeAgentTemplate]
    }),
    new Spawn({
        maxCount: 3,
        maxDepth: 2,
        agentTemplates: [generalPurposeAgentTemplate]
    })
);