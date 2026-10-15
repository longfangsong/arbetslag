export interface CompletionAgent {
  readonly id: string;
  historyId: string;
  apiId: string;
  allowedTools: Array<string>;
}

export interface DecisionAgent {
  readonly id: string;
  historyId: string;
  apiId: string;
}
