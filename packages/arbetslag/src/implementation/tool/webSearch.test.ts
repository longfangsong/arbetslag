import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSearch } from "./webSearch";
import type { ToolExecutingContext } from "@/application/tool/model";

const ctx: ToolExecutingContext = { fileSystem: null as never };

// Small interval values so real timers can exercise the same rate limit
// logic (10-20s) in milliseconds. Same code path; different scale.
const MIN_MS = 50;
const MAX_MS = 200;
const IDLE_MS = 300; // > MAX_MS: always long enough to clear a cooldown
const makeTool = () =>
	new WebSearch("http://localhost:3333", 1_000, 10, MIN_MS, MAX_MS);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const fetchMock = vi.fn();

/** Real-time timestamps of the search requests actually sent. */
let sentAt: number[];

describe("WebSearch rate limit", () => {
	beforeEach(async () => {
		sentAt = [];
		fetchMock.mockImplementation(() => {
			sentAt.push(Date.now());
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: () => Promise.resolve({ results: [] }),
			};
		});
		vi.stubGlobal("fetch", fetchMock);
		// Rate limit state is process-global; clear any leftover cooldown.
		await delay(IDLE_MS);
	});

	afterEach(() => {
		fetchMock.mockClear();
		vi.unstubAllGlobals();
	});

	it("sends the first search without blocking", async () => {
		const start = Date.now();
		const tool = makeTool();
		const result = await tool.call(ctx, null as never, { query: "hello" });
		expect(result.isOk()).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// No rate limit wait: cooldown was cleared by the idle delay.
		expect(Date.now() - start).toBeLessThan(IDLE_MS);
	});

	it("blocks the second search until the interval is satisfied", async () => {
		const tool = makeTool();
		await tool.call(ctx, null as never, { query: "a" });
		const resultPromise = tool.call(ctx, null as never, { query: "b" });

		// The random interval is always >= MIN_MS, so a few ms in is
		// still too early.
		await delay(10);
		expect(fetchMock).toHaveBeenCalledTimes(1); // second search still blocked

		// MAX_MS + margin: the second search must now have been sent.
		await delay(300);
		const result = await resultPromise;
		expect(result.isOk()).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("spaces consecutive searches by a random interval within [min, max]", async () => {
		const tool = makeTool();
		await tool.call(ctx, null as never, { query: "a" });
		const resultPromise = tool.call(ctx, null as never, { query: "b" });
		await delay(300);
		const result = await resultPromise;
		expect(result.isOk()).toBe(true);
		const gap = sentAt[1] - sentAt[0];
		expect(gap).toBeGreaterThanOrEqual(MIN_MS);
		expect(gap).toBeLessThanOrEqual(MAX_MS + 20);
	});

	it("does not block after idle longer than the max interval", async () => {
		const tool = makeTool();
		await tool.call(ctx, null as never, { query: "a" });
		await delay(IDLE_MS);
		const result = await tool.call(ctx, null as never, { query: "b" });
		expect(result.isOk()).toBe(true);
		// No extra blocking: the second search is sent as soon as the idle
		// period (IDLE_MS > MAX_MS) makes it legal, not after another
		// random wait.
		const gap = sentAt[1] - sentAt[0];
		expect(gap).toBeGreaterThanOrEqual(IDLE_MS - 50);
		expect(gap).toBeLessThan(IDLE_MS + MAX_MS);
	});

	it("enforces the interval across separate WebSearch instances", async () => {
		const toolA = makeTool();
		const toolB = makeTool();
		await toolA.call(ctx, null as never, { query: "a" });
		const resultPromise = toolB.call(ctx, null as never, { query: "b" });
		await delay(300);
		const result = await resultPromise;
		expect(result.isOk()).toBe(true);
		const gap = sentAt[1] - sentAt[0];
		expect(gap).toBeGreaterThanOrEqual(MIN_MS);
		expect(gap).toBeLessThanOrEqual(MAX_MS + 20);
	});
});
