import { JsonValue } from "type-fest";
import { CompletionAPI } from "./abstraction/completion";
import { Tool } from "./abstraction/tool";

export interface Runtime {
	completionAPIs: Array<CompletionAPI>,
	tools: Array<Tool<any, any>>,
}

export interface InputAdapter<I> {
  readonly id: string;
  convert: (from: I) => JsonValue;
}

export class Orchestrator {
	
}
