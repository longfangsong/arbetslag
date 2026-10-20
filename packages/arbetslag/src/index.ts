import { CompletionAPI } from "./abstraction/completion";
import { Tool } from "./abstraction/tool";
import { ChooseAPI } from "./abstraction/choose";
import type { Store } from "./abstraction/store";
import { InputAdapter } from "./abstraction/inputAdapter";
import { OutputAdapter } from "./abstraction/outputAdapter";
import { UserFunction } from "./abstraction/userFunction";

export { Inbox, Outbox, type Sink, type Source } from "./messageBox";

export { InputAdapter } from "./abstraction/inputAdapter";
export { OutputAdapter } from "./abstraction/outputAdapter";
export { WebhookOutputAdapter } from "./implementation/output/webhook";
export type { WebhookDeliveryOptions } from "./implementation/output/webhook";

/** Everything a `Runtime` can hold: graph nodes that run, plus provider APIs. */
export type Runnable =
	| InputAdapter
	| OutputAdapter
	| UserFunction
	| Tool<any, any>
	| CompletionAPI
	| ChooseAPI;

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
	 *
	 * Dispatch is on `kind`, so a new subclass needs no change here.
	 */
	register(registrable: Runnable): void {
		switch (registrable.kind) {
			case "tool":
				this.add(this.tools, registrable);
				return;
			case "completionAPI":
				this.add(this.completionAPIs, registrable);
				return;
			case "chooseAPI":
				this.add(this.chooseAPIs, registrable);
				return;
			case "userFunction":
				this.add(this.userFunctions, registrable);
				return;
			case "input":
				this.add(this.inputs, registrable);
				return;
			case "output":
				this.add(this.outputs, registrable);
				return;
		}
	}

	/** Two registrations under one id would make `fromSerialized` ambiguous. */
	private add<T extends { readonly id: string }>(list: Array<T>, item: T): void {
		if (list.some((existing) => existing.id === item.id)) {
			throw new Error(`Already registered: ${item.id}`);
		}
		list.push(item);
	}
}
