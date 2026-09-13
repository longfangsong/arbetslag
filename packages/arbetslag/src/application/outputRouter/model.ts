import { Result } from "neverthrow";
import { AgentOutput } from "../event/event";

/**
 * A message from the framework runtime to the user (as opposed to the agent's
 * own utterance). `content` is the default copy (localization is the host's
 * decision); structured fields let a host render its own wording.
 */
export interface SystemNotice {
	kind: "history_compacted";
	content: string;
	/** Estimated tokens before compaction; only set when something was compacted. */
	beforeTokens?: number;
	/** Estimated tokens after compaction; only set when something was compacted. */
	afterTokens?: number;
}

export interface OutputRouter {
	route(event: AgentOutput | SystemNotice): Promise<Result<void, string>>;
}