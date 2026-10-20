import type { JsonValue } from "type-fest";
import { CompletionAPI } from "./abstraction/completion";
import { Tool } from "./abstraction/tool";
import { ChooseAPI } from "./abstraction/choose";
import type { Store } from "./abstraction/store";
import type { ConstructibleNode, NodeClass } from "./projectNode";
import { nodeName } from "./utils";

export { Inbox, Outbox, type Sink, type Source } from "./messageBox";

export { InputAdapter } from "./abstraction/inputAdapter";
export { OutputAdapter } from "./abstraction/outputAdapter";
export { WebhookOutputAdapter } from "./implementation/output/webhook";
export type { WebhookDeliveryOptions } from "./implementation/output/webhook";

/**
 * What a runtime holds as a live instance: tools and provider APIs.
 *
 * They are not rebuildable from a project file — they hold API keys and clients —
 * and they are not graph nodes either, so they can be neither registered as a
 * node nor connected to anything.
 */
export type Runnable = Tool<any, any> | CompletionAPI | ChooseAPI;

/** Rebuilds a graph node from the `class` and `config` in a project file. */
export type NodeFactory = (config?: JsonValue) => ConstructibleNode;

export class Runtime {
	/**
	 * How to rebuild each node class, keyed by the class's own name. The factory
	 * takes the config from the file and closes over everything the file cannot
	 * hold (a server, a client, a connection pool).
	 */
	private readonly nodeClasses: Record<string, NodeFactory> = {};

	readonly tools: Record<string, Tool<any, any>> = {};
	readonly completionAPIs: Record<string, CompletionAPI> = {};
	readonly chooseAPIs: Record<string, ChooseAPI> = {};

	constructor(public store: Store) {}

	/**
	 * Teach the runtime how to rebuild one node class from a project file.
	 *
	 * `className` must be the class's own name — `nodeClass(Double.name, ...)` —
	 * because that is what `Project.toSerialized` writes and what `build` checks
	 * the produced instance against.
	 */
	nodeClass(className: string, factory: NodeFactory): void {
		if (this.nodeClasses[className]) {
			throw new Error(`Already registered: ${className}`);
		}
		this.nodeClasses[className] = factory;
	}

	/** Register a live tool or provider under its derived name. */
	register(instance: Runnable): void {
		switch (instance.kind) {
			case "tool":
				put(this.tools, instance);
				return;
			case "completionAPI":
				put(this.completionAPIs, instance);
				return;
			case "chooseAPI":
				put(this.chooseAPIs, instance);
				return;
		}
	}

	/**
	 * Rebuild one node. Fails loudly if the factory builds something other than
	 * the class it was registered for — that mismatch is what minifying user code
	 * would cause, and a silent one would wire the graph to the wrong node.
	 */
	build<N extends ConstructibleNode>(node: NodeClass<N>): N {
		const factory = this.nodeClasses[node.class];
		if (!factory) {
			throw new Error(`No node class registered as: ${node.class}`);
		}
		const built = factory(node.config);
		if (built.constructor.name !== node.class) {
			throw new Error(
				`Factory for ${node.class} produced a ${built.constructor.name}`,
			);
		}
		if (built.kind !== node.kind) {
			throw new Error(`${node.class} is a ${built.kind}, not a ${node.kind}`);
		}
		return built as N;
	}
}

function put<T extends object>(bucket: Record<string, T>, item: T): void {
	const name = nodeName(item);
	if (bucket[name]) {
		throw new Error(`Already registered: ${name}`);
	}
	bucket[name] = item;
}
