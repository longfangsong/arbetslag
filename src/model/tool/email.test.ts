import { describe, it, expect, beforeEach, vi } from "vitest";
import { SendEmail } from "./email";
import { InMemoryFileSystem } from "../fileSystem/inMemory";
import { InMemoryAgentRepository } from "../agentRepository";
import { createRuntime, type Context } from "../context";
import { ok, err } from "./";

describe("SendEmail", () => {
  let tool: SendEmail;
  let fs: InMemoryFileSystem;
  let context: Context;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    const runtime = createRuntime([], [], fs, [], {}, new InMemoryAgentRepository());
    context = runtime.context;
    tool = new SendEmail();
  });

  it("requires email_api_url in config", async () => {
    const result = await tool.handler(context, "agent-1", {
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
    });

    expect(result).toEqual(err("Email API URL not found in context config. Provide 'email_api_url' when creating Context."));
  });

  it("requires email_api_key in config", async () => {
    const runtime = createRuntime(
      [], [], fs, [],
      { email_api_url: "https://api.example.com/send" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;

    const result = await tool.handler(context, "agent-1", {
      to: "user@example.com",
      subject: "Test",
      body: "Hello",
    });

    expect(result).toEqual(err("Email API key not found in context config. Provide 'email_api_key' when creating Context."));
  });

  it("sends email via API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ messageId: "msg-123" }),
      status: 200,
    });
    global.fetch = mockFetch as any;

    const runtime = createRuntime(
      [], [], fs, [],
      { email_api_url: "https://api.example.com/send", email_api_key: "test-key" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;

    const result = await tool.handler(context, "agent-1", {
      to: "user@example.com",
      subject: "Test Subject",
      body: "Hello from agent",
    });

    expect(result).toEqual(ok({ messageId: "msg-123" }));
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          to: "user@example.com",
          subject: "Test Subject",
          body: "Hello from agent",
        }),
      }),
    );
  });

  it("returns error on API error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: "invalid_email" }),
      status: 400,
    });
    global.fetch = mockFetch as any;

    const runtime = createRuntime(
      [], [], fs, [],
      { email_api_url: "https://api.example.com/send", email_api_key: "test-key" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;

    const result = await tool.handler(context, "agent-1", {
      to: "invalid-email",
      subject: "Test",
      body: "Hello",
    });

    expect(result).toEqual(err("Email API error: invalid_email"));
  });
});
