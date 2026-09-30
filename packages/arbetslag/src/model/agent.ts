import { type History, create as createHistory, text } from "./history";
import { nanoid } from "../utils";

export interface Agent {
  id: string;
  modelId: string;
  historyId: string;
  toolIds: Array<string>;
}

export function create(
  modelId: string,
  toolIds: Array<string>,
): { agent: Agent; history: History } {
  const history = createHistory();
  return {
    agent: {
      id: nanoid(),
      modelId,
      historyId: history.id,
      toolIds,
    },
    history,
  };
}

export interface Template {
  id: string;
  modelId: string;
  toolIds: Array<string>;
  systemPrompt: string;
}

export function createFromTemplate(template: Template): {
  agent: Agent;
  history: History;
} {
  const { agent, history } = create(template.modelId, template.toolIds);
  history.entries.push({
    role: "system",
    content: text(template.systemPrompt)
  });
  return { agent, history };
}
