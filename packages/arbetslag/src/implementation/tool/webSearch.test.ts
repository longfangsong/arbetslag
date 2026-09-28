import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@/application/agent/model";
import { WebSearch } from "./webSearch";

const MCP_URL = "https://mcp.exa.ai/mcp";
const CALLER = {} as Agent;
const CTX = { fileSystem: {} as never };

type Canned = {
	status?: number;
	contentType?: string;
	headers?: Record<string, string>;
	json?: unknown;
	sse?: string;
};

type Call = {
	headers: Record<string, string>;
	body: {
		method?: string;
		params?: {
			name?: string;
			arguments?: { query?: string; objective?: string; numResults?: number };
		};
	};
};

let calls: Call[];
let queue: Canned[];

function sse(payload: unknown): string {
	return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function searchResponse(text: string, isError = false): unknown {
	return {
		jsonrpc: "2.0",
		id: 2,
		result: { content: [{ type: "text", text }], isError },
	};
}

function initResponse(sessionId: string): Canned {
	return {
		headers: { "mcp-session-id": sessionId },
		json: {
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				serverInfo: { name: "exa" },
			},
		},
	};
}

function mockFetch() {
	const fetchMock = vi.fn(async (_url: unknown, init?: {
		headers?: Record<string, string>;
		body?: string;
	}) => {
		const call: Call = {
			headers: { ...(init?.headers ?? {}) },
			body: JSON.parse(init?.body ?? "{}"),
		};
		calls.push(call);
		const canned = queue.shift() ?? {};
		const status = canned.status ?? 200;
		const contentType =
			canned.contentType ??
			(canned.sse != null ? "text/event-stream" : "application/json");
		const bodyText = canned.sse ?? JSON.stringify(canned.json ?? {});
		return {
			status,
			ok: status < 400,
			headers: new Headers({
				"content-type": contentType,
				...(canned.headers ?? {}),
			}),
			text: async () => bodyText,
			body: contentType.includes("text/event-stream")
				? Readable.from([Buffer.from(bodyText)])
				: null,
		};
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const SEARCH_TEXT = `Title: TypeScript 6.0
URL: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
Published: 2026-09-22T08:00:57.283Z
Author: N/A
Highlights:
Work to enable this new target.
New Types for Temporal

---

Title: TS 6 blog
URL: https://example.com/blog/ts6
Published: N/A
Author: Jane
Highlights:
A blog post about TypeScript 6.`;

describe("WebSearch", () => {
	beforeEach(() => {
		calls = [];
		queue = [];
		vi.unstubAllGlobals();
		mockFetch();
	});

	it("initializes a session, then calls web_search_exa and parses results", async () => {
		queue = [
			initResponse("s1"),
			{ status: 202 },
			{ sse: sse(searchResponse(SEARCH_TEXT)) },
		];
		const tool = new WebSearch();
		const res = await tool.call(CTX, CALLER, { query: "typescript 6" });

		expect(res.isOk()).toBe(true);
		const results = res._unsafeUnwrap();
		expect(results).toHaveLength(2);
		expect(results[0].title).toBe("TypeScript 6.0");
		expect(results[0].url).toBe(
			"https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html",
		);
		expect(results[0].publishedDate).toBe("2026-09-22T08:00:57.283Z");
		expect(results[0].author).toBeUndefined();
		expect(results[0].content).toBe(
			"Work to enable this new target.\nNew Types for Temporal",
		);
		expect(results[1].title).toBe("TS 6 blog");
		expect(results[1].author).toBe("Jane");
		expect(results[1].publishedDate).toBeUndefined();
		expect(results[1].content).toBe("A blog post about TypeScript 6.");

		expect(calls).toHaveLength(3);
		expect(calls[0].body.method).toBe("initialize");
		expect(calls[0].headers["Mcp-Session-Id"]).toBeUndefined();
		expect(calls[1].body.method).toBe("notifications/initialized");
		expect(calls[1].headers["Mcp-Session-Id"]).toBe("s1");
		expect(calls[2].body.method).toBe("tools/call");
		expect(calls[2].headers["Mcp-Session-Id"]).toBe("s1");
		expect(calls[2].body.params?.name).toBe("web_search_exa");
		expect(calls[2].body.params?.arguments?.query).toBe("typescript 6");
		expect(calls[2].body.params?.arguments?.numResults).toBe(10);
		expect(calls[2].body.params?.arguments?.objective).toBeTruthy();
	});

	it("reuses the session across calls", async () => {
		queue = [
			initResponse("s1"),
			{ status: 202 },
			{ sse: sse(searchResponse(SEARCH_TEXT)) },
			{ sse: sse(searchResponse(SEARCH_TEXT)) },
		];
		const tool = new WebSearch();
		await tool.call(CTX, CALLER, { query: "first" });
		const res = await tool.call(CTX, CALLER, { query: "second" });

		expect(res.isOk()).toBe(true);
		const inits = calls.filter((c) => c.body.method === "initialize");
		expect(inits).toHaveLength(1);
		expect(calls).toHaveLength(4);
		expect(calls[3].body.method).toBe("tools/call");
		expect(calls[3].headers["Mcp-Session-Id"]).toBe("s1");
		expect(calls[3].body.params?.arguments?.query).toBe("second");
	});

	it("returns an empty list when there are no results", async () => {
		queue = [
			initResponse("s1"),
			{ status: 202 },
			{
				sse: sse(
					searchResponse(
						"No search results found. Please try a different query.",
					),
				),
			},
		];
		const tool = new WebSearch();
		const res = await tool.call(CTX, CALLER, { query: "nothing" });
		expect(res.isOk()).toBe(true);
		expect(res._unsafeUnwrap()).toEqual([]);
	});

	it("maps a tool-level error (isError) to err", async () => {
		queue = [
			initResponse("s1"),
			{ status: 202 },
			{
				sse: sse(
					searchResponse(
						"You've hit Exa's free MCP rate limit. To continue using without limits, create your own Exa API key.",
						true,
					),
				),
			},
		];
		const tool = new WebSearch();
		const res = await tool.call(CTX, CALLER, { query: "too many" });
		expect(res.isErr()).toBe(true);
		expect(res._unsafeUnwrapErr()).toContain("free MCP rate limit");
	});

	it("reinitializes once and retries when the session is stale", async () => {
		queue = [
			initResponse("s1"),
			{ status: 202 },
			{
				status: 400,
				json: {
					jsonrpc: "2.0",
					id: 2,
					error: { code: -32000, message: "Unknown session" },
				},
			},
			initResponse("s2"),
			{ status: 202 },
			{ sse: sse(searchResponse(SEARCH_TEXT)) },
		];
		const tool = new WebSearch();
		const res = await tool.call(CTX, CALLER, { query: "retry" });

		expect(res.isOk()).toBe(true);
		const inits = calls.filter((c) => c.body.method === "initialize");
		expect(inits).toHaveLength(2);
		expect(calls.at(-1)?.headers["Mcp-Session-Id"]).toBe("s2");
	});

	it("returns err when initialize is rejected", async () => {
		queue = [
			{
				status: 402,
				json: { error: "Payment required to access this resource" },
			},
		];
		const tool = new WebSearch();
		const res = await tool.call(CTX, CALLER, { query: "no key" });
		expect(res.isErr()).toBe(true);
		expect(res._unsafeUnwrapErr()).toContain("402");
	});

	it("sends the Authorization header when an API key is configured", async () => {
		queue = [initResponse("s1"), { status: 202 }, { sse: sse(searchResponse(SEARCH_TEXT)) }];
		const tool = new WebSearch(MCP_URL, "sk-test");
		const res = await tool.call(CTX, CALLER, { query: "with key" });
		expect(res.isOk()).toBe(true);
		for (const call of calls) {
			expect(call.headers.Authorization).toBe("Bearer sk-test");
		}
	});

	it("handles plain JSON (non-SSE) responses", async () => {
		queue = [
			initResponse("s1"),
			{ status: 202 },
			{
				json: searchResponse("Title: X\nURL: https://a.b\nHighlights:\nhi"),
			},
		];
		const tool = new WebSearch();
		const res = await tool.call(CTX, CALLER, { query: "json" });
		expect(res.isOk()).toBe(true);
		expect(res._unsafeUnwrap()).toEqual([
			{ title: "X", url: "https://a.b", content: "hi" },
		]);
	});
});
