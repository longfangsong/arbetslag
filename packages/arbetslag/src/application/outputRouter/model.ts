import { Result } from "neverthrow";
import { AgentOutput } from "../event/event";

/**
 * An agent's history was compacted: an agent-scoped fact (the token counts
 * are that agent's) routed as a user-visible notice by the orchestrator on
 * the agent's behalf. The output router decides whether and how to tell the
 * user.
 */
export interface Compacted {
	kind: "history_compacted";
	/** Estimated tokens before compaction; only set when something was compacted. */
	beforeTokens?: number;
	/** Estimated tokens after compaction; only set when something was compacted. */
	afterTokens?: number;
}

export interface OutputRouter {
	route(event: AgentOutput | Compacted): Promise<Result<void, string>>;
}