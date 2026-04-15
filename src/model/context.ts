import { AIProvider } from "./aiProvider";
import { Tool } from "./tool";

export class Context {
    constructor(
        public aiProviders: Array<AIProvider>
    ) {
    }

    getAIProvider(name: string): AIProvider | undefined {
        return this.aiProviders.find(provider => provider.name === name);
    }
}