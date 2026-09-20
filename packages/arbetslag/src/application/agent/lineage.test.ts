import { describe, it, expect } from "vitest";
import { Agent } from "./model";
import type { Template } from "./template/model";

const template: Template = {
  name: "lineage",
  description: "",
  ai_provider: "",
  model: "",
  systemPrompt: "",
  allowedTools: [],
};

describe("Creator lineage", () => {
  it("records the Creator and survives serialize → deserialize", async () => {
    const entry = Agent.create(template);
    const sub = Agent.create(template, entry);
    expect(entry.createdByAgentId).toBeUndefined(); // an entry agent has no Creator
    expect(sub.createdByAgentId).toBe(entry.id);
    expect(Agent.deserialize(sub.serialize()).createdByAgentId).toBe(entry.id);
  });
});
