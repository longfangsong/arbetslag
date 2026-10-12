import { describe, it, expect } from "vitest";
import { ok, err } from "neverthrow";
import { unwrap } from "../utils";
import { Orchestrator } from "./orchestrator";
import {
  text,
  contentText,
  type HistoryEntry,
} from "./agent/history";
import type { MessageEvent } from "./event/event";
import { InMemoryFileSystem } from "@/implementation/tool/file/filesystem/inMemory";
import { FileSystemAgentRepository } from "@/implementation/agent/repository";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";
import { InMemoryAIProviderRepository } from "@/implementation/aiProvider/inMemory";
import { InMemoryToolRepository } from "@/implementation/tool/repository";
import type { AIProvider } from "./aiProvider/model";
import type { Template } from "./agent/template/model";

const sampleTemplate: Template = {
  name: "test",
  description: "test template",
  ai_provider: "openai",
  model: "gpt-4",
  systemPrompt: "You are a test agent.",
  allowedTools: [],
};

let eventCounter = 0;
function message(chatId: string, content: string): MessageEvent {
  eventCounter++;
  return {
    id: `evt-${eventCounter}`,
    event_type: "message",
    chat_id: chatId,
    adapter: "test",
    content: text(content),
    send_time: Date.now(),
  };
}

/** Plain text of a history entry (user entries carry parts, assistant a string). */
function entryText(h: HistoryEntry): string {
  return h.role === "assistant" || h.role === "tool"
    ? h.content
    : contentText(h.content);
}

/** One-line rendering of a history entry for ordering assertions. */
function render(h: HistoryEntry): string {
  switch (h.role) {
    case "system":
      return "system";
    case "user":
      return `u:${entryText(h)}`;
    default:
      return entryText(h);
  }
}

/**
 * Provider whose n-th completion replies `a:${n}`. Call order is observable
 * in the produced history; `holdMs` delays completions to create overlap.
 */
function makeProvider(
  holdMs: number,
  stats: { inFlight: number; max: number },
  calls: { n: number },
): AIProvider {
  return {
    name: "openai",
    async complete() {
      stats.inFlight++;
      stats.max = Math.max(stats.max, stats.inFlight);
      calls.n++;
      const n = calls.n;
      await new Promise((r) => setTimeout(r, holdMs));
      stats.inFlight--;
      return ok({
        role: "assistant",
        content: `a:${n}`,
        tool_calls: [],
      });
    },
  };
}

async function makeOrchestrator(provider: AIProvider) {
  const fs = new InMemoryFileSystem();
  const agentRepository = await FileSystemAgentRepository.create(fs, "agents/");
  const templateRepository = await FileSystemTemplateRepository.create(
    fs,
    "templates/",
  );
  await templateRepository.add(sampleTemplate);
  const orchestrator = new Orchestrator({
    fileSystem: fs,
    agentRepository,
    templateRepository,
    toolRepository: new InMemoryToolRepository([]),
    aiProviderRepository: new InMemoryAIProviderRepository([provider]),
    outputRouter: null,
  });
  return { agentRepository, orchestrator };
}

describe("concurrent chat lanes", () => {
  it("dispatches events of different chats concurrently", async () => {
    const stats = { inFlight: 0, max: 0 };
    const calls = { n: 0 };
    const { agentRepository, orchestrator } = await makeOrchestrator(
      makeProvider(50, stats, calls),
    );
    orchestrator.push(message("chat-1", "q1"));
    orchestrator.push(message("chat-2", "q2"));
    unwrap(await orchestrator.stepUntilIdle());

    // The two LLM completions overlapped — a serial loop would show max 1.
    expect(stats.max).toBe(2);
    expect(orchestrator.empty()).toBe(true);

    const a1 = (await agentRepository.getByChatId("chat-1"))!;
    const a2 = (await agentRepository.getByChatId("chat-2"))!;
    // Each chat: system, user, assistant — and the two replies are the two
    // (distinct) completions, one per chat.
    expect(a1.history.map((h) => h.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(a2.history.map((h) => h.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect([entryText(a1.history[2]), entryText(a2.history[2])].sort()).toEqual([
      "a:1",
      "a:2",
    ]);
  });

  it("keeps one chat's events in queue FIFO order (derived events appended)", async () => {
    const stats = { inFlight: 0, max: 0 };
    const calls = { n: 0 };
    const { agentRepository, orchestrator } = await makeOrchestrator(
      makeProvider(30, stats, calls),
    );
    // A burst pushed before processing: user entries land first, then the
    // completions in the same order — the same semantics the old serial
    // step loop had for a pre-queued burst.
    orchestrator.push(message("chat-1", "q1"));
    orchestrator.push(message("chat-1", "q2"));
    orchestrator.push(message("chat-1", "q3"));
    unwrap(await orchestrator.stepUntilIdle());

    const agent = (await agentRepository.getByChatId("chat-1"))!;
    expect(agent.history.map(render)).toEqual([
      "system",
      "u:q1",
      "u:q2",
      "u:q3",
      "a:1",
      "a:2",
      "a:3",
    ]);
  });

  it("does not let a follow-up message overtake an in-flight completion", async () => {
    const stats = { inFlight: 0, max: 0 };
    const calls = { n: 0 };
    let releaseFirst: () => void;
    const firstStarted = new Promise<void>((r) => (releaseFirst = r));
    let first = true;
    const provider: AIProvider = {
      name: "openai",
      async complete() {
        if (first) {
          first = false;
          releaseFirst();
          await new Promise((r) => setTimeout(r, 40)); // hold the lane
        }
        stats.inFlight++;
        stats.max = Math.max(stats.max, stats.inFlight);
        const n = ++calls.n;
        stats.inFlight--;
        return ok({ role: "assistant", content: `a:${n}`, tool_calls: [] });
      },
    };
    const { agentRepository, orchestrator } = await makeOrchestrator(provider);
    orchestrator.push(message("chat-1", "q1"));
    await firstStarted; // llmreq(q1) is now in flight
    await new Promise((r) => setTimeout(r, 0)); // let the lane settle
    orchestrator.push(message("chat-1", "q2"));
    unwrap(await orchestrator.stepUntilIdle());

    const agent = (await agentRepository.getByChatId("chat-1"))!;
    // q2 queues behind the in-flight completion; the reply to q1 still
    // lands before the reply to q2.
    expect(agent.history.map(render)).toEqual([
      "system",
      "u:q1",
      "u:q2",
      "a:1",
      "a:2",
    ]);
  });

  it("creates exactly one entry agent when messages race into a new chat", async () => {
    const stats = { inFlight: 0, max: 0 };
    const calls = { n: 0 };
    const { agentRepository, orchestrator } = await makeOrchestrator(
      makeProvider(20, stats, calls),
    );
    orchestrator.push(message("chat-new", "a"));
    orchestrator.push(message("chat-new", "b"));
    unwrap(await orchestrator.stepUntilIdle());

    const agents = await agentRepository.list();
    expect(agents.filter((a) => a.chatId === "chat-new")).toHaveLength(1);
    expect(agents[0].history.map((h) => h.role)).toEqual([
      "system",
      "user",
      "user",
      "assistant",
      "assistant",
    ]);
  });

  it("records dispatch errors, drains the queue, and keeps working", async () => {
    let failed = false;
    const provider: AIProvider = {
      name: "openai",
      async complete() {
        if (!failed) {
          failed = true;
          return err("boom");
        }
        await new Promise((r) => setTimeout(r, 10));
        return ok({ role: "assistant", content: "ok", tool_calls: [] });
      },
    };
    const { orchestrator } = await makeOrchestrator(provider);
    orchestrator.push(message("chat-1", "q1"));
    orchestrator.push(message("chat-2", "q2"));
    const first = await orchestrator.stepUntilIdle();
    expect(first.isErr()).toBe(true);
    if (first.isErr()) expect(first.error).toBe("boom");
    // The queue fully drained despite the failure.
    expect(orchestrator.empty()).toBe(true);

    // The system keeps serving: the failed chat's next message gets a reply.
    orchestrator.push(message("chat-1", "q2"));
    unwrap(await orchestrator.stepUntilIdle());
  });
});
