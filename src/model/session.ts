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
  private _agents: Array<Agent> = [];
  currentAgentId: string | null = null;

  constructor(startBy: User | Event) {
    this.id = nanoid(10);
    this.startBy = startBy;
  }

  get agents(): Array<Agent> {
    return this._agents;
  }

  addAgent(agent: Agent): void {
    this._agents.push(agent);
  }
}
