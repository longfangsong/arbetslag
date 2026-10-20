import type { JsonValue } from "type-fest";
import type { InputAdapter } from "./abstraction/inputAdapter";
import type { OutputAdapter } from "./abstraction/outputAdapter";
import type { UserFunction } from "./abstraction/userFunction";
import type { CompletionAgent, DecisionAgent } from "./agent";

/**
 * The kinds that can appear as a node in a `Project` graph.
 *
 * Kind is a field, not a prefix in a name: nothing has to parse anything to learn
 * what a node is, and the compiler narrows `switch (node.kind)` for us.
 */
export type NodeKind = "input" | "output" | "userFunction" | "completion" | "decision";

/** The nodes a project file can rebuild: class name plus constructor arguments. */
export type ConstructibleNode = InputAdapter | OutputAdapter | UserFunction;

/**
 * The node union. Tools and provider APIs are deliberately absent: they are
 * runtime implementations, not graph nodes, so they cannot be connected.
 */
export type Registrable = ConstructibleNode | CompletionAgent | DecisionAgent;

export type NodeOfKind<K extends NodeKind> = Extract<Registrable, { readonly kind: K }>;

/**
 * How a project file says "rebuild this node": which class, with what config.
 *
 * `kind` is redundant with the class but is what the caller checks against — a
 * file claiming an output where the class produces a user function is corrupt,
 * and should say so rather than quietly become a different kind of node.
 */
export interface NodeClass<N extends ConstructibleNode = ConstructibleNode> {
	readonly kind: N["kind"];
	readonly class: string;
	readonly config?: JsonValue;
}

/** A node as it appears in a project file. Its position in the array is its identity. */
export type SerializedNode = NodeClass | CompletionAgent | DecisionAgent;
