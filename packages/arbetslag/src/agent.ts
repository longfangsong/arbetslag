export interface CompletionAgent {
  readonly kind: "completion";
  readonly id: string;
  historyId: string;
  apiId: string;
  allowedTools: Array<string>;
}

export interface DecisionAgent {
  readonly kind: "decision";
  readonly id: string;
  historyId: string;
  apiId: string;
}
