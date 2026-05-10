import { describe, it, expect, beforeEach, vi } from "vitest";
import { SendSlackMessage } from "./slack";
import { InMemoryFileSystem } from "../fileSystem/inMemory";
import { InMemoryAgentRepository } from "../agentRepository";
import { createRuntime, type Context } from "../context";
import { ok, err } from "./";

describe("SendSlackMessage", () => {
  let tool: SendSlackMessage;
  let fs: InMemoryFileSystem;
  let context: Context;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    const runtime = createRuntime([], [], fs, [], {}, new InMemoryAgentRepository());
    context = runtime.context;
    tool = new SendSlackMessage();
  });

  it("requires slack_bot_token in config", async () => {
    const result = await tool.handler(context, "agent-1", {
      channel: "#general",
      text: "Hello",
    });

    expect(result).toEqual(err("Slack bot token not found in context config. Provide 'slack_bot_token' when creating Context."));
  });

  it("sends message via Slack API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, channel: "C123", ts: "123.456" }),
      status: 200,
    });
    global.fetch = mockFetch as any;

    const runtime = createRuntime(
      [], [], fs, [],
      { slack_bot_token: "xoxb-test-token" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;

    const result = await tool.handler(context, "agent-1", {
      channel: "#general",
      text: "Hello from agent",
    });

    expect(result).toEqual(ok({ channel: "C123", ts: "123.456" }));
    expect(mockFetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer xoxb-test-token",
        },
        body: JSON.stringify({ channel: "#general", text: "Hello from agent" }),
      }),
    );
  });

  it("returns error on Slack API error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
      status: 400,
    });
    global.fetch = mockFetch as any;

    const runtime = createRuntime(
      [], [], fs, [],
      { slack_bot_token: "xoxb-test-token" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;

    const result = await tool.handler(context, "agent-1", {
      channel: "#nonexistent",
      text: "Hello",
    });

    expect(result).toEqual(err("Slack API error: channel_not_found"));
  });
});
