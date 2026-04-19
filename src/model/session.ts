import { nanoid } from "nanoid/non-secure";
import { Agent } from "./agent";
import { FileSystem } from "./fileSystem";

interface User {
    prompt: string;
}

interface Event {
    type: string;
    data: any;
}

export class Session {
    readonly id: string;
    startBy: User | Event;
    agents: Array<Agent> = [];

    constructor(startBy: User | Event) {
        this.id = nanoid(10);
        this.startBy = startBy;
    }

    async recordMessages(agentId: string, messages: unknown[], fileSystem: FileSystem): Promise<void> {
        const filePath = `run/${this.id}/${agentId}.json`;
        await fileSystem.writeFile(filePath, JSON.stringify(messages));
    }
}
