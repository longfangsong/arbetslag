import { describe, it, expect } from "vitest";
import { Agent } from "./model";
import type { Template } from "./template/model";
import type { MessageEvent } from "@/application/event/event";
import type { Content, ContentPart } from "./history";

const template: Template = {
  name: "t",
  description: "",
  ai_provider: "openai",
  model: "gpt-4",
  systemPrompt: "sys",
  allowedTools: [],
};
const singleImageTemplate: Template = { ...template, singleImage: true };

let n = 0;
const img = (url: string): ContentPart => ({ type: "image", url });
const t = (s: string): ContentPart => ({ type: "text", text: s });

function msg(parts: Array<ContentPart>): MessageEvent {
  return {
    id: `m${++n}`,
    event_type: "message",
    chat_id: "c1",
    adapter: "test",
    content: parts,
    send_time: Date.now(),
  };
}

function reply(agent: Agent, content: string): void {
  agent.history.push({ role: "assistant", content });
}

/** Content of every user entry, in order. */
function userContents(agent: Agent): Array<Content> {
  return agent.history
    .filter((h): h is { role: "user"; content: Content } => h.role === "user")
    .map((h) => h.content);
}

/** All image parts across the agent's user entries, in order. */
function imagesIn(agent: Agent): Array<ContentPart> {
  return agent.history
    .flatMap((h) => (h.role === "user" ? h.content : []))
    .filter((p) => p.type === "image");
}

function markerCount(agent: Agent): number {
  return agent.history
    .flatMap((h) => (h.role === "user" ? h.content : []))
    .filter((p) => p.type === "text" && p.text === "[Image]").length;
}

describe("Agent singleImage (endpoint carries ≤1 image per request)", () => {
  it("demotes earlier images to [Image] text when a new image arrives", () => {
    const agent = Agent.create(singleImageTemplate);
    agent.handleMessage(msg([t("cap1"), img("data:A")]));
    reply(agent, "reply 1");
    agent.handleMessage(msg([t("cap2"), img("data:B")]));

    const [, first, , second] = agent.history;
    expect(first.content).toEqual([t("cap1"), t("[Image]")]);
    expect(second.content).toEqual([t("cap2"), img("data:B")]);
    expect(imagesIn(agent)).toEqual([img("data:B")]);
  });

  it("keeps the earlier image on a text-only message", () => {
    const agent = Agent.create(singleImageTemplate);
    agent.handleMessage(msg([img("data:A")]));
    reply(agent, "reply 1");
    agent.handleMessage(msg([t("follow-up")]));

    expect(imagesIn(agent)).toEqual([img("data:A")]);
  });

  it("does not demote when singleImage is unset", () => {
    const agent = Agent.create(template);
    agent.handleMessage(msg([img("data:A")]));
    reply(agent, "reply 1");
    agent.handleMessage(msg([img("data:B")]));

    expect(imagesIn(agent)).toHaveLength(2);
  });

  it("keeps only the newest image after several image rounds", () => {
    const agent = Agent.create(singleImageTemplate);
    for (const url of ["data:A", "data:B", "data:C"]) {
      agent.handleMessage(msg([img(url)]));
      reply(agent, "ok");
    }

    expect(imagesIn(agent)).toEqual([img("data:C")]);
    expect(markerCount(agent)).toBe(2);
  });

  it("demotes all images of earlier entries, including multiple per entry", () => {
    const agent = Agent.create(singleImageTemplate);
    agent.handleMessage(msg([img("data:A"), img("data:B")]));
    reply(agent, "ok");
    agent.handleMessage(msg([img("data:C")]));

    expect(userContents(agent)[0]).toEqual([t("[Image]"), t("[Image]")]);
    expect(imagesIn(agent)).toEqual([img("data:C")]);
  });
});
