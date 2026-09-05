import { AgentOutput } from "../event/event";

export interface OutputRouter {
    route(event: AgentOutput): Promise<void>;
}