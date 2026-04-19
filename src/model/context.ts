import { AIProvider } from "./aiProvider";
import { Tool } from "./tool";
import { FileSystem } from "./fileSystem";
import { Template } from "./agent";

type NamedToolCtor = (new (...args: any[]) => Tool<any, any>) & { name  : string };

export class Context {
    constructor(
        public aiProviders: Array<AIProvider>,
        public tools: Array<NamedToolCtor>,
        public fileSystem: FileSystem,
        public agentTemplates: Array<Template>,
    ) {
    }

    getAIProvider(name: string): AIProvider | undefined {
        return this.aiProviders.find(provider => provider.name === name);
    }

    getToolConstructor(name: string): NamedToolCtor | undefined {
        return this.tools.find(ctor => ctor.name === name);
    }

    getTemplate(name: string): Template | undefined {
        return this.agentTemplates.find(template => template.name === name);
    }
}
