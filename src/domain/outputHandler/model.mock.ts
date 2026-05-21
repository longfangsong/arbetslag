import { MutableState } from "@/application/orchestrator";
import { Agent } from "../agent/model";
import { OutputHandler, UserOutputHandler } from "./model";

/**
 * Concrete UserOutputHandler for tests.
 */
export class TestUserOutputHandler extends UserOutputHandler {
	async handle(state: MutableState, _agent: Agent, _content: string): Promise<MutableState> {
		return state;
	}
}
