import { Result } from "neverthrow";
import { AgentOutput } from "../event/event";

/**
 * A structured notice from the framework runtime. 
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