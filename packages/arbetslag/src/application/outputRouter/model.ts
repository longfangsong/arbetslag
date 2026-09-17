import { Result } from "neverthrow";
import { AgentOutput } from "../event/event";

/**
 * A structured notice from the framework runtime (as opposed to the agent's
 * own utterance). Hosts render the user-facing wording from `kind` and the
 * token counts themselves (localization is the host's decision).
 */
export interface SystemNotice {
	kind: "history_compacted";
	/** Estimated tokens before compaction; only set when something was compacted. */
	beforeTokens?: number;
	/** Estimated tokens after compaction; only set when something was compacted. */
	afterTokens?: number;
}

export interface OutputRouter {
	route(event: AgentOutput | SystemNotice): Promise<Result<void, string>>;
}