import { State } from "@/application/orchestrator";
import { Agent } from "../agent/model";
import { OutputHandler, UserOutputHandler } from "./model";

/**
 * Concrete UserOutputHandler for tests.
 */
export class TestUserOutputHandler extends UserOutputHandler {
	async handle(state: State, _agent: Agent, _content: string): Promise<State> {
		return state;
	}
}
