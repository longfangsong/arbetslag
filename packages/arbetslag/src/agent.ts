/**
 * An agent is plain data, so it goes into a project file as-is — which is the
 * only reason it needs a reference to its provider at all: `api` is the provider
 * class's derived name (`OpenAIProvider` → `openAI`), resolved in the `Runtime`.
 */
export interface CompletionAgent {
  readonly kind: "completion";
  historyId: string;
  /** Derived name of the `CompletionAPI` this agent thinks with. */
  api: string;
  /** Derived names of the tools this agent may call. */
  allowedTools: Array<string>;
}

export interface DecisionAgent {
  readonly kind: "decision";
  historyId: string;
  /** Derived name of the `ChooseAPI` this agent decides with. */
  api: string;
}
