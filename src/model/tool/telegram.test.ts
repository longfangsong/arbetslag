import { describe, it, expect, beforeEach, vi } from "vitest";
import { SendTelegramMessage } from "./telegram";
import { InMemoryFileSystem } from "../fileSystem/inMemory";
import { InMemoryAgentRepository } from "../agentRepository";
import { createRuntime, type Context } from "../context";
import { ok, err } from "./";

describe("SendTelegramMessage", () => {
  let tool: SendTelegramMessage;
  let fs: InMemoryFileSystem;
  let context: Context;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    const runtime = createRuntime([], [], fs, [], {}, new InMemoryAgentRepository());
    context = runtime.context;
    tool = new SendTelegramMessage();
  });

  it("requires telegram_bot_token in config", async () => {
    const result = await tool.handler(context, "agent-1", {
      chat_id: "12345",
      text: "Hello",
    });

    expect(result).toEqual(err("Telegram bot token not found in context config. Provide 'telegram_bot_token' when creating Context."));
  });

  it("sends message via Telegram API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
      status: 200,
    });
    global.fetch = mockFetch as any;

    const runtime = createRuntime(
      [], [], fs, [],
      { telegram_bot_token: "test-token" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;

    const result = await tool.handler(context, "agent-1", {
      chat_id: "12345",
      text: "Hello from agent",
    });

    expect(result).toEqual(ok({ result: { message_id: 42 } }));
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: "12345", text: "Hello from agent" }),
      }),
    );
  });

  it("returns error on Telegram API error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error_code: 400, description: "Bad Request" }),
      status: 400,
    });
    global.fetch = mockFetch as any;

    const runtime = createRuntime(
      [], [], fs, [],
      { telegram_bot_token: "test-token" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;

    const result = await tool.handler(context, "agent-1", {
      chat_id: "invalid",
      text: "Hello",
    });

    expect(result).toEqual(err('Telegram API error: {"ok":false,"error_code":400,"description":"Bad Request"}'));
  });
});
