import { extractPreviousSummary } from "./compact";
import { HistoryEntry, ToolCall, hasToolCalls, hasUnansweredToolCall } from "./history";
import type { Agent } from "./model";

/** The tool that reads a Report: a Wait names exactly one Agent per call. */
export const WAIT_TOOL_NAME = "wait_for_agent";

/**
 * The open Waits in `history`: Wait tool calls with no result entry yet. The
 * history is the record — nothing is stored separately, so a pending Wait is
 * already persisted with the agent, and it survives a restart.
 */
export function openWaits(history: Array<HistoryEntry>): Array<ToolCall> {
  return history
    .filter(hasToolCalls)
    .flatMap((e) => e.tool_calls)
    .filter(
      (tc) =>
        tc.tool_name === WAIT_TOOL_NAME && hasUnansweredToolCall(history, tc.id),
    );
}

/** The open Wait in `history` naming `agentId`. */
export function openWait(
  history: Array<HistoryEntry>,
  agentId: string,
): ToolCall | undefined {
  return openWaits(history).find((tc) => tc.arguments.agent_id === agentId);
}

/**
 * The Report an Agent with a Creator delivers to its Creator: the content of the
 * turn it ends with (no tool calls). Nothing is stored for it — the history entry
 * is the Report, and it is persisted with the Agent. A Wait reads the last one;
 * when that turn has been compacted away, the compaction summary stands in.
 */
export function reportOf(agent: Agent): string | undefined {
  for (let i = agent.history.length - 1; i > 0; --i) {
    const entry = agent.history[i];
    if (entry.role === "assistant" && !entry.tool_calls?.length) return entry.content;
  }
  return extractPreviousSummary(agent.history[0]);
}
