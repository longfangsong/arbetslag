import { CompletionAPI } from "./abstraction/completion";
import { Tool } from "./abstraction/tool";
import { ChooseAPI } from "./abstraction/choose";
import { Store } from "./abstraction/store";
import { InputAdapter } from "./abstraction/inputAdapter";
import { OutputAdapter } from "./abstraction/outputAdapter";
import { UserFunction } from "./abstraction/userFunction";

/** Adapters are plain interfaces, so they are told apart by their methods. */
function isInputAdapter(value: object): value is InputAdapter {
	return typeof (value as InputAdapter).processable === "function";
}

function isOutputAdapter(value: object): value is OutputAdapter {
	return typeof (value as OutputAdapter).deliver === "function";
}

export class Runtime {
	public completionAPIs: Array<CompletionAPI> = [];
	public chooseAPIs: Array<ChooseAPI> = [];
	public tools: Array<Tool<any, any>> = [];
	public userFunctions: Array<UserFunction> = [];
	public inputs: Array<InputAdapter> = [];
	public outputs: Array<OutputAdapter> = [];
	constructor(public store: Store) {}

	/**
	 * Register an actor or adapter by identity, so a serialized `Project` can
	 * resolve it back by id (see `Project.fromSerialized`).
	 */
	register(
		registrable:
			| CompletionAPI
			| ChooseAPI
			| Tool<any, any>
			| UserFunction
			| InputAdapter
			| OutputAdapter,
	): void {
		if (registrable instanceof Tool) {
			this.tools.push(registrable);
		} else if (registrable instanceof CompletionAPI) {
			this.completionAPIs.push(registrable);
		} else if (registrable instanceof ChooseAPI) {
			this.chooseAPIs.push(registrable);
		} else if (registrable instanceof UserFunction) {
			this.userFunctions.push(registrable);
		} else if (isInputAdapter(registrable)) {
			this.inputs.push(registrable);
		} else if (isOutputAdapter(registrable)) {
			this.outputs.push(registrable);
		} else {
			throw new Error(`Cannot register unknown kind: ${registrable}`);
		}
	}
}
