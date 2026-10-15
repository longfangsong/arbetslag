import { JsonValue } from "type-fest";
import { OutputAdapter } from "./abstraction/outputAdapter";
import { UserFunction } from "./abstraction/userFunction";
import { CompletionAgent, DecisionAgent } from "./agent";
import { InputAdapter } from "./abstraction/inputAdapter";
import { isKind, ProjectNode, Registrable } from "./projectNode";
import { Actor } from "./actor";
import type { Runtime } from "./index";
import { type, unimplemented } from "./utils";

export interface SerializedProject {
	completionAgents: Array<CompletionAgent>,
	decisionAgents: Array<DecisionAgent>,
	userFunctions: Array<string>,
	inputs: Array<string>,
	outputs: Array<string>,
	connections: Array<[string, string]>,
	toolsState: Record<string, JsonValue>
}


function findById<T extends { id: string }>(items: Array<T>, id: string): T {
	const item = items.find((it) => it.id === id);
	if (!item) throw new Error(`No registered ${type(id)} with id: ${id}`);
	return item;
}

export class Project {
	completionAgents: Array<CompletionAgent> = [];
	decisionAgents: Array<DecisionAgent> = [];
	userFunctions: Array<UserFunction> = [];
	inputs: Array<InputAdapter> = [];
	outputs: Array<OutputAdapter> = [];
	connections: Array<[string, string]> = [];
	toolsState: Record<string, JsonValue> = {};

	/**
	 * Rebuild a `Project` from its serialized form. Agents are plain data and
	 * come along; actors and adapters are looked up in `runtime` by id, since
	 * they cannot be serialized.
	 */
	static fromSerialized(serialized: SerializedProject, runtime: Runtime): Project {
		const project = new Project();
		project.completionAgents.push(...serialized.completionAgents);
		project.decisionAgents.push(...serialized.decisionAgents);
		project.userFunctions.push(
			...serialized.userFunctions.map((id) => findById(runtime.userFunctions, id)),
		);
		project.inputs.push(...serialized.inputs.map((id) => findById(runtime.inputs, id)));
		project.outputs.push(
			...serialized.outputs.map((id) => findById(runtime.outputs, id)),
		);
		project.connections.push(...serialized.connections);
		project.toolsState = { ...serialized.toolsState };
		return project;
	}

	register(node: Registrable): void {
		// The kind of a node is encoded in its id, see `idForType`.
		const id = node.id;
		if (isKind(node, "userFunction")) {
			this.userFunctions.push(node);
		} else if (isKind(node, "input")) {
			this.inputs.push(node);
		} else if (isKind(node, "output")) {
			this.outputs.push(node);
		} else if (isKind(node, "completion")) {
			this.completionAgents.push(node);
		} else if (isKind(node, "decision")) {
			this.decisionAgents.push(node);
		} else {
			throw new Error(`Unknown node id: ${id}`);
		}
	}

	start(runtime: Runtime): void {
		const actors: Array<Actor<any, any>> = [
			...this.userFunctions,
			...runtime.tools,
			...runtime.completionAPIs,
			...runtime.chooseAPIs,
		];
		for (const actor of actors) {
			const receiver = actor.start();
			(async () => {
				for await (const input of receiver) {
                	this.deliver(input, runtime, input);
            	}
			})();
		}
	}

	private deliver(
		fromActor: Actor<unknown, unknown> | InputAdapter,
		runtime: Runtime,
		message: JsonValue,
	): void {
		const deliverTo = this.connections.filter(([from, _]) => from === fromActor.id);
		for (const [_, to] of deliverTo) {
			if(type(to) === "output") {
				const output = this.outputs.find(it => it.id === to)!;
				output.deliver(message);
			}
			const actor = this.findActor(to, runtime);
			actor.send(message);
		}
	}

	connect(from: ProjectNode, to: ProjectNode): void {
		this.connections.push([from.id, to.id]);
	}

	findActor(id: string, runtime: Runtime): Actor<any, any> {
		switch (type(id)) {
			case "userFunction": {
				const userFunction = this.userFunctions.find((node) => node.id === id);
				return userFunction!;
			}
			case "completion": {
				const agent = this.completionAgents.find((node) => node.id === id);
				if (!agent) return unimplemented();
				return runtime.completionAPIs.find((api) => api.id === agent.apiId)!;
			}
			case "decision": {
				const agent = this.decisionAgents.find((node) => node.id === id);
				if (!agent) return unimplemented();
				return runtime.chooseAPIs.find((api) => api.id === agent.apiId)!;
			}
			case "tool":
				return runtime.tools.find((tool) => tool.id === id)!;
			default:
				// Inputs and outputs are not actors yet.
				return unimplemented();
		}
	}

	async handleInput(runtime: Runtime, input: JsonValue): Promise<void> {
		for (let adapter of this.inputs) {
			if (await adapter.processable(input)) {
				const result = await adapter.receive(input);
				const targets = this.connections.filter(([from, _]) => from === adapter.id)!;
				for (const target of targets) {
					this.deliver(adapter, runtime, result);
				}
			}
		}
	}
}
