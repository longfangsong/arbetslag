import { InputAdapter } from ".";
import { OutputAdapter } from "./abstraction/outputAdapter";
import { UserFunction } from "./abstraction/userFunction";
import { CompletionAgent, DecisionAgent } from "./agent";

export interface SerizedProject {
	completionAgents: Array<CompletionAgent>,
	decisionAgents: Array<DecisionAgent>,
	userFunctions: Array<string>,
	inputs: Array<string>,
	outputs: Array<string>,
    connections: Array<[string, string]>,
}


export type Registrable =
	| CompletionAgent
	| DecisionAgent
	| UserFunction
	| InputAdapter<unknown>
	| OutputAdapter;

export class Project {
	completionAgents: Array<CompletionAgent> = [];
	decisionAgents: Array<DecisionAgent> = [];
	userFunctions: Array<UserFunction> = [];
	inputs: Array<InputAdapter<unknown>> = [];
	outputs: Array<OutputAdapter> = [];
    connections: Array<[string, string]> = [];

    
	register(node: Registrable): void {
		if ("function" in node) {
			this.userFunctions.push(node);
		} else if ("convert" in node) {
			this.inputs.push(node);
		} else if ("deliver" in node) {
			this.outputs.push(node);
		} else if ("allowedTools" in node) {
			this.completionAgents.push(node);
		} else {
			this.decisionAgents.push(node);
		}
	}

	connect(from: { id: string }, to: { id: string }): void {
		this.connections.push([from.id, to.id]);
	}
}