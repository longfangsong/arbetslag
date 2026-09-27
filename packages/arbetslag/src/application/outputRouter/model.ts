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

/** Everything an OutputRouter can receive: an agent's reply or a framework notice. */
export type OutputEvent = AgentOutput | Compacted;

/** Persisted form of a router: the implementation kind plus its own fields. */
export interface SerializedOutputRouter {
	kind: string;
	config: Record<string, unknown>;
}

/**
 * The channel one Agent replies on — a member of that Agent, so it must
 * survive serialization: `kind` names the implementation and the Registry
 * rebuilds the instance when the agent is loaded.
 */
export interface OutputRouter {
	readonly kind: string;
	serialize(): SerializedOutputRouter;
	route(event: OutputEvent): Promise<Result<void, string>>;
}
