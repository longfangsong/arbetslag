import { InputAdapter } from "./abstraction/inputAdapter";
import { OutputAdapter } from "./abstraction/outputAdapter";
import { UserFunction } from "./abstraction/userFunction";
import { CompletionAgent, DecisionAgent } from "./agent";
import { type as typeOfId } from "./utils";

/**
 * Anything that can be registered in a `Project`. The kind of a node is encoded
 * in its id, see `idForType`.
 */
export interface ProjectNode {
	readonly id: string;
}

interface NodeOfType {
	userFunction: UserFunction;
	input: InputAdapter;
	output: OutputAdapter;
	completion: CompletionAgent;
	decision: DecisionAgent;
}

export type NodeType = keyof NodeOfType;

export type Registrable = NodeOfType[NodeType];

export function isKind<T extends NodeType>(
	node: Registrable,
	kind: T,
): node is NodeOfType[T] {
	return typeOfId(node.id) === kind;
}
