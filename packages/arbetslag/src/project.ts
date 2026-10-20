import type { JsonValue } from "type-fest";
import type { OutputAdapter } from "./abstraction/outputAdapter";
import type { UserFunction } from "./abstraction/userFunction";
import type { InputAdapter } from "./abstraction/inputAdapter";
import type { NodeKind, NodeOfKind, Registrable, SerializedNode } from "./projectNode";
import type { Sink, Source } from "./messageBox";
import type { Runtime } from "./index";
import { classNameOf } from "./utils";

/**
 * A project on disk.
 *
 * A node's identity is its position in `nodes` — nothing is named, indexed or
 * minted, so `connections` is a pair of array positions. The flip side is that
 * the order of `nodes` is load-bearing: rewriting the file must be done by
 * whoever owns it, and merging two versions by hand silently rewires the graph.
 */
export interface SerializedProject {
	nodes: Array<SerializedNode>;
	connections: Array<[number, number]>;
	toolsState: Record<string, JsonValue>;
}

export class Project {
	/** The graph, in file order: the position *is* the node's identity. */
	private readonly nodes: Array<Registrable> = [];

	connections: Array<[number, number]> = [];
	toolsState: Record<string, JsonValue> = {};

	/** Set by `start`, so `stop` can reach the runtime-provided actors. */
	private runtime: Runtime | undefined;
	private inputDrives: Array<Promise<void>> = [];
	private actorDrives: Array<Promise<void>> = [];
	private shutdown: Promise<void> | undefined;

	get inputs(): Array<InputAdapter> {
		return this.ofKind("input");
	}

	get outputs(): Array<OutputAdapter> {
		return this.ofKind("output");
	}

	get userFunctions(): Array<UserFunction> {
		return this.ofKind("userFunction");
	}

	get completionAgents(): Array<NodeOfKind<"completion">> {
		return this.ofKind("completion");
	}

	get decisionAgents(): Array<NodeOfKind<"decision">> {
		return this.ofKind("decision");
	}

	/**
	 * Rebuild a `Project` from its serialized form. Agents are plain data and come
	 * along as they are; everything else is rebuilt from its class, so the runtime
	 * must know every class the file names.
	 */
	static fromSerialized(serialized: SerializedProject, runtime: Runtime): Project {
		const project = new Project();
		for (const node of serialized.nodes) {
			if (node.kind === "completion" || node.kind === "decision") {
				project.register({ ...node });
			} else {
				project.register(runtime.build(node));
			}
		}
		project.connections.push(...serialized.connections);
		project.toolsState = { ...serialized.toolsState };
		return project;
	}

	/** The inverse of `fromSerialized`: same nodes, same order, same wiring. */
	toSerialized(): SerializedProject {
		return {
			nodes: this.nodes.map((node): SerializedNode => {
				if (node.kind === "completion" || node.kind === "decision") {
					return { ...node };
				}
				return { kind: node.kind, class: classNameOf(node), config: node.config };
			}),
			connections: this.connections.map(([from, to]): [number, number] => [from, to]),
			toolsState: { ...this.toolsState },
		};
	}

	register(node: Registrable): void {
		if (this.nodes.includes(node)) {
			throw new Error(`Already in this project: ${node.kind}`);
		}
		this.nodes.push(node);
	}

	/**
	 * Run the graph: one loop per `Source`, pushing whatever it emits to the
	 * sinks named by `connections`.
	 *
	 * Resolves once every source has ended, rejects with the first error after
	 * stopping the rest of the graph.
	 */
	async start(runtime: Runtime): Promise<void> {
		this.runtime = runtime;
		this.inputDrives = this.inputs.map((input) => this.drive(input, runtime));
		this.actorDrives = this.actors(runtime).map((actor) => this.drive(actor, runtime));
		const results = await Promise.allSettled([...this.inputDrives, ...this.actorDrives]);
		const failed = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (failed) throw failed.reason;
	}

	/**
	 * Graceful shutdown: close the entry points, let their in-flight payloads
	 * reach the graph, then close the actors so their loops drain and end.
	 *
	 * Deliveries already in flight *between* actors are not covered — with a cycle
	 * in the graph there is no order that would.
	 */
	stop(): Promise<void> {
		this.shutdown ??= this.shutdownGraph();
		return this.shutdown;
	}

	private async shutdownGraph(): Promise<void> {
		const runtime = this.runtime;
		if (!runtime) return;
		await Promise.all(this.inputs.map((input) => input.stop()));
		await Promise.allSettled(this.inputDrives);
		await Promise.all(this.actors(runtime).map((actor) => actor.stop()));
		await Promise.allSettled(this.actorDrives);
	}

	/** Wire two nodes by identity: the positions are the whole edge. */
	connect(from: Registrable, to: Registrable): void {
		this.connections.push([this.position(from), this.position(to)]);
	}

	private position(node: Registrable): number {
		const index = this.nodes.indexOf(node);
		if (index < 0) throw new Error(`Not registered in this project: ${node.kind}`);
		return index;
	}

	private ofKind<K extends NodeKind>(kind: K): Array<NodeOfKind<K>> {
		return this.nodes.filter((node): node is NodeOfKind<K> => node.kind === kind);
	}

	private node(index: number): Registrable {
		const node = this.nodes[index];
		if (!node) throw new Error(`No node at position: ${index}`);
		return node;
	}

	/**
	 * Everything inside the graph that both receives and emits.
	 *
	 * Runtime tools and providers are driven too, because that is what starts
	 * their consume loop — but no edge can name them, so whatever they emit is
	 * dropped (see `deliver`).
	 */
	private actors(runtime: Runtime): Array<Source<unknown>> {
		return [
			...this.userFunctions,
			...Object.values(runtime.tools),
			...Object.values(runtime.completionAPIs),
			...Object.values(runtime.chooseAPIs),
		];
	}

	private async drive(source: Source<unknown>, runtime: Runtime): Promise<void> {
		try {
			for await (const message of source) {
				await this.deliver(source, message, runtime);
			}
		} catch (error) {
			// One broken edge stops the whole graph. Not awaited: `stop` waits for
			// this very drive, so awaiting it here would deadlock the shutdown.
			void this.stop();
			throw error;
		}
	}

	private async deliver(
		from: Source<unknown>,
		message: unknown,
		runtime: Runtime,
	): Promise<void> {
		for (const [fromIndex, toIndex] of this.connections) {
			// Reference comparison: a runtime implementation is not a node, so it
			// matches nothing and its output goes nowhere.
			if (this.nodes[fromIndex] !== from) continue;
			await this.sink(toIndex, runtime).send(message);
		}
	}

	/**
	 * Where a message lands: an actor or an output.
	 *
	 * Typed as `Sink<unknown>` on purpose — the wire format is `JsonValue` while
	 * each node takes its own request shape, and that mismatch predates this class.
	 */
	private sink(index: number, runtime: Runtime): Sink<unknown> {
		const node = this.node(index);
		switch (node.kind) {
			case "output":
				return node;
			case "userFunction":
				return node;
			case "completion": {
				const api = runtime.completionAPIs[node.api];
				if (!api) throw new Error(`No completion API registered as: ${node.api}`);
				return api;
			}
			case "decision": {
				const api = runtime.chooseAPIs[node.api];
				if (!api) throw new Error(`No choose API registered as: ${node.api}`);
				return api;
			}
			case "input":
				throw new Error(`An input is a source, not a sink (position ${index})`);
		}
	}
}
