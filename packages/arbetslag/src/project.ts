import type { JsonValue } from "type-fest";
import type { OutputAdapter } from "./abstraction/outputAdapter";
import type { UserFunction } from "./abstraction/userFunction";
import type { CompletionAgent, DecisionAgent } from "./agent";
import type { InputAdapter } from "./abstraction/inputAdapter";
import type { NodeKind, ProjectNode, Registrable } from "./projectNode";
import type { Sink, Source } from "./messageBox";
import type { Runtime } from "./index";

/**
 * A project on disk. `kind` is not serialized: which array a node appears in
 * already says what it is.
 */
export interface SerializedProject {
	completionAgents: Array<Omit<CompletionAgent, "kind">>,
	decisionAgents: Array<Omit<DecisionAgent, "kind">>,
	userFunctions: Array<string>,
	inputs: Array<string>,
	outputs: Array<string>,
	connections: Array<[string, string]>,
	toolsState: Record<string, JsonValue>
}

type NodeOfKind<K extends NodeKind> = Extract<Registrable, { readonly kind: K }>;

function findById<T extends { readonly id: string }>(items: Array<T>, id: string): T {
	const item = items.find((it) => it.id === id);
	if (!item) throw new Error(`Nothing registered with id: ${id}`);
	return item;
}

export class Project {
	/** The single source of truth: every node, by id. */
	private readonly nodes: Map<string, Registrable> = new Map();

	connections: Array<[string, string]> = [];
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

	get completionAgents(): Array<CompletionAgent> {
		return this.ofKind("completion");
	}

	get decisionAgents(): Array<DecisionAgent> {
		return this.ofKind("decision");
	}

	/**
	 * Rebuild a `Project` from its serialized form. Agents are plain data and
	 * come along; actors and adapters are looked up in `runtime` by id, since
	 * they cannot be serialized.
	 */
	static fromSerialized(serialized: SerializedProject, runtime: Runtime): Project {
		const project = new Project();
		for (const agent of serialized.completionAgents) {
			project.register({ ...agent, kind: "completion" });
		}
		for (const agent of serialized.decisionAgents) {
			project.register({ ...agent, kind: "decision" });
		}
		for (const id of serialized.userFunctions) {
			project.register(findById(runtime.userFunctions, id));
		}
		for (const id of serialized.inputs) {
			project.register(findById(runtime.inputs, id));
		}
		for (const id of serialized.outputs) {
			project.register(findById(runtime.outputs, id));
		}
		project.connections.push(...serialized.connections);
		project.toolsState = { ...serialized.toolsState };
		return project;
	}

	register(node: Registrable): void {
		if (this.nodes.has(node.id)) {
			throw new Error(`Duplicate node id: ${node.id}`);
		}
		this.nodes.set(node.id, node);
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

	connect(from: ProjectNode, to: ProjectNode): void {
		this.connections.push([from.id, to.id]);
	}

	private ofKind<K extends NodeKind>(kind: K): Array<NodeOfKind<K>> {
		return [...this.nodes.values()].filter(
			(node): node is NodeOfKind<K> => node.kind === kind,
		);
	}

	private node(id: string): Registrable {
		const node = this.nodes.get(id);
		if (!node) throw new Error(`No node with id: ${id}`);
		return node;
	}

	/** Everything inside the graph that both receives and emits. */
	private actors(runtime: Runtime): Array<Source<unknown>> {
		return [
			...this.userFunctions,
			...runtime.tools,
			...runtime.completionAPIs,
			...runtime.chooseAPIs,
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
		from: { readonly id: string },
		message: unknown,
		runtime: Runtime,
	): Promise<void> {
		for (const [fromId, toId] of this.connections) {
			if (fromId !== from.id) continue;
			await this.sink(toId, runtime).send(message);
		}
	}

	/**
	 * Where a message lands: an actor or an output.
	 *
	 * Typed as `Sink<any>` on purpose — the wire format is `JsonValue` while each
	 * node takes its own request shape, and that mismatch predates this class.
	 */
	private sink(id: string, runtime: Runtime): Sink<any> {
		const node = this.node(id);
		switch (node.kind) {
			case "output":
				return node;
			case "userFunction":
				return node;
			case "completion":
				return findById(runtime.completionAPIs, node.apiId);
			case "decision":
				return findById(runtime.chooseAPIs, node.apiId);
			case "input":
				throw new Error(`An input is a source, not a sink: ${id}`);
		}
	}
}
