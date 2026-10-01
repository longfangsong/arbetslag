import { Result } from "neverthrow";
import type { Agent, Template } from "./agent";
import type { History } from "./history";
import { LLMProvider } from "./llmProvider";
import { Tool } from "./tool";
import { Event, Reducer } from "..";

/**
 * Part of the state of the system which should be persistent directely
 */
export interface Persistent {
  agents: Array<Agent>;
  templates: Array<Template>;
  histories: Array<History>;
}

/**
 * Part of the state of the system which should be constructed
 * or registered in code.
 */
export interface Runtime {
  llmProviders: Array<LLMProvider>;
  eventBus: Array<Event>;
  waiting: Array<[(e: Event) => boolean, Reducer<Event>]>;
  tools: Array<Tool<unknown>>;
}

/**
 * The state of the system.
 */
export interface State {
  persistent: Persistent;
  runtime: Runtime;
}

/**
 * Returns the first history for which the next step is an LLM
 * completion, or `undefined` if none is.
 *
 * A "ready" history either:
 * - ends with a user message
 * - ends with a CompletionResult with X toolCalls + Y ToolCallResult,
 *   where X == Y
 */
export function getAllReadyHistory(state: State): History | undefined {
  return state.persistent.histories.find(isReady);
}

export function getAgentForHistory(state: State, historyId: string): Agent | undefined {
  return state.persistent.agents.find(it => it.historyId === historyId);
}

function isReady(history: History): boolean {
  const entries = history.entries;
  const last = entries[entries.length - 1];
  if (last === undefined) {
    return false;
  }
  if (last.role === "user") {
    return true;
  }

  let toolResults = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || entry.role !== "tool") {
      break;
    }
    toolResults++;
  }
  const completion = entries[entries.length - 1 - toolResults];
  if (completion === undefined || completion.role !== "assistant") {
    return false;
  }
  const toolCalls = completion.toolCalls?.length ?? 0;
  return toolCalls > 0 && toolCalls === toolResults;
}
