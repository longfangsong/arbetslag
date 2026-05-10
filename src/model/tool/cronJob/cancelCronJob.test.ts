import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRuntime, type Context } from "../../context";
import { InMemoryFileSystem } from "../../fileSystem/inMemory";
import { InMemoryAgentRepository } from "../../agentRepository";
import { ok, err } from "..";
import { CancelCronJob, CancelCronJobInputSchema } from "./cancelCronJob";

describe("CancelCronJob", () => {
  let context: Context;
  let tool: CancelCronJob;
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    const runtime = createRuntime([], [], fs, [], {}, new InMemoryAgentRepository());
    context = runtime.context;
    tool = new CancelCronJob();
  });

  it("should have correct name and schema", () => {
    expect(CancelCronJob.toolName).toBe("cancelCronJob");
    expect(tool.description).toContain("Cancel a scheduled cron job");
  });

  it("returns error when cron_token is missing", async () => {
    const result = await tool.handler(context, "agent-1", { jobId: 12345 });
    expect(result).toEqual(err("Cron token not found in context config. Provide 'cron_token' when creating Context."));
  });

  it("calls cron-job.org DELETE API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      statusText: "OK",
      text: () => Promise.resolve('{"success":true}'),
    });
    global.fetch = mockFetch as any;

    const runtime = createRuntime(
      [], [], fs, [],
      { cron_token: "test-token" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;
    tool = new CancelCronJob();

    const result = await tool.handler(context, "agent-1", { jobId: 12345 });

    expect(result).toEqual(ok({ jobId: 12345 }));
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cron-job.org/jobs/12345",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("returns error on API error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Not Found",
      text: () => Promise.resolve('{"error":"job not found"}'),
    });
    global.fetch = mockFetch as any;

    const runtime = createRuntime(
      [], [], fs, [],
      { cron_token: "test-token" },
      new InMemoryAgentRepository(),
    );
    context = runtime.context;
    tool = new CancelCronJob();

    const result = await tool.handler(context, "agent-1", { jobId: 99999 });
    expect(result).toEqual(err("Failed to cancel cron job 99999: Not Found — {\"error\":\"job not found\"}"));
  });

  it("validates jobId is a positive integer", () => {
    expect(() =>
      CancelCronJobInputSchema.parse({ jobId: -1 }),
    ).toThrow();
    expect(() =>
      CancelCronJobInputSchema.parse({ jobId: 0 }),
    ).toThrow();
    expect(() =>
      CancelCronJobInputSchema.parse({ jobId: 1 }),
    ).not.toThrow();
  });
});
