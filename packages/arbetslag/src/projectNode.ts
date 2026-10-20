import type { InputAdapter } from "./abstraction/inputAdapter";
import type { OutputAdapter } from "./abstraction/outputAdapter";
import type { UserFunction } from "./abstraction/userFunction";
import type { CompletionAgent, DecisionAgent } from "./agent";

/**
 * The kinds that can appear as a node in a `Project` graph.
 *
 * Kind is a field, not a prefix in the id: nothing has to parse an id to learn
 * what a node is, and the compiler narrows `switch (node.kind)` for us.
 */
export type NodeKind = "input" | "output" | "userFunction" | "completion" | "decision";

/** Anything a `Project` can hold and wire to something else. */
export interface ProjectNode {
	readonly id: string;
	readonly kind: NodeKind;
}

/**
 * The node union. Tools and provider APIs are deliberately absent: they are
 * runtime implementations, not graph nodes, so they cannot be connected.
 */
export type Registrable =
	| InputAdapter
	| OutputAdapter
	| UserFunction
	| CompletionAgent
	| DecisionAgent;
