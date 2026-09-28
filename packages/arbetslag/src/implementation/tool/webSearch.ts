import { z } from "zod";
import { Result, err, ok } from "neverthrow";
import { Agent } from "@/application/agent/model";
import { Tool, ToolExecutingContext } from "@/application/tool/model";

/**
 * Web search via the Exa MCP server (https://mcp.exa.ai/mcp), which speaks
 * MCP streamable HTTP (JSON-RPC over POST). This class is a minimal,
 * single-purpose MCP client: it only ever calls the server's
 * `web_search_exa` tool. It works anonymously (free rate limits) and
 * optionally sends an Exa API key for higher limits.
 */

export const WebSearchInputSchema = z
	.object({
		query: z
			.string()
			.describe(
				"Search query. Describe the ideal page, not just keywords.",
			),
	})
	.describe("Search the web with the Exa search engine.");

export interface WebSearchResult {
	title: string;
	url: string;
	content: string;
	publishedDate?: string;
	author?: string;
}

const DEFAULT_MCP_URL = "https://mcp.exa.ai/mcp";
const PROTOCOL_VERSION = "2025-06-18";
const SEARCH_TOOL = "web_search_exa";
const OBJECTIVE =
	"Find the most relevant and up-to-date pages that answer the query, with factual content and working URLs.";

interface JsonRpcMessage {
	id?: number;
	result?: unknown;
	error?: { code: number; message: string };
}

interface ToolResult {
	content?: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

interface RawResponse {
	status: number;
	sessionId: string | null;
	message: JsonRpcMessage | null;
	rawText: string;
}

function truncate(text: string): string {
	const t = text.trim();
	return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}

function na(value?: string): string | undefined {
	return value && value !== "N/A" ? value : undefined;
}

function extractField(lines: string[], name: string): string | undefined {
	const line = lines.find((l) => l.startsWith(`${name}:`));
	return line?.slice(name.length + 1).trim();
}

function parseMessage(text: string): JsonRpcMessage | null {
	try {
		const msg = JSON.parse(text);
		if (
			msg &&
			typeof msg === "object" &&
			(msg.result !== undefined || msg.error !== undefined)
		) {
			return msg as JsonRpcMessage;
		}
	} catch {
		// not JSON (incomplete line, comment, …) — keep scanning
	}
	return null;
}

function extractMessage(
	text: string,
	contentType: string | null,
): JsonRpcMessage | null {
	if (contentType?.includes("text/event-stream")) {
		for (const line of text.split(/\r?\n/)) {
			if (line.startsWith("data:")) {
				const msg = parseMessage(line.slice("data:".length).trim());
				if (msg) return msg;
			}
		}
		return null;
	}
	return text.trim() === "" ? null : parseMessage(text);
}

/**
 * Exa MCP returns each search result as a block of
 * "Title/URL/Published/Author" lines plus "Highlights:" (or "Text:")
 * content, with blocks separated by blank-line, "---", blank-line.
 */
function parseSearchText(text: string): WebSearchResult[] {
	const trimmed = text.trim();
	if (/^no search results found/i.test(trimmed)) return [];

	const results: WebSearchResult[] = [];
	for (const block of trimmed.split(/\n{2,}---\n{2,}/)) {
		const lines = block.trim().split(/\r?\n/);
		const url = extractField(lines, "URL");
		if (!url) continue;

		let content = "";
		const highlightsIdx = lines.findIndex((l) =>
			l.startsWith("Highlights:"),
		);
		const textIdx = lines.findIndex((l) => l.startsWith("Text:"));
		if (highlightsIdx >= 0) {
			content = lines.slice(highlightsIdx + 1).join("\n").trim();
		} else if (textIdx >= 0) {
			content = lines
				.slice(textIdx)
				.map((l, i) => (i === 0 ? l.slice("Text:".length).trim() : l))
				.join("\n")
				.trim();
		}

		results.push({
			title: extractField(lines, "Title") ?? "",
			url,
			content,
			publishedDate: na(extractField(lines, "Published")),
			author: na(extractField(lines, "Author")),
		});
	}
	return results;
}

export class WebSearch implements Tool<
	z.infer<typeof WebSearchInputSchema>,
	WebSearchResult[],
	string
> {
	name = "web_search";
	description =
		"Search the web using the Exa search engine and return matching results (title, URL, content, publication date).";
	inputSchema = WebSearchInputSchema;

	private readonly url: string;
	private readonly apiKey?: string;
	private readonly timeoutMs: number;
	private readonly numResults: number;
	private sessionId: string | null = null;

	constructor(
		url: string = DEFAULT_MCP_URL,
		apiKey?: string,
		timeoutMs = 60_000,
		numResults = 10,
	) {
		this.url = url;
		this.apiKey = apiKey;
		this.timeoutMs = timeoutMs;
		this.numResults = numResults;
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof WebSearchInputSchema>,
	): Promise<Result<WebSearchResult[], string>> {
		try {
			await this.ensureSession();
			let res = await this.search(input.query);
			if (res.status === 400 || res.status === 404) {
				// The session may have expired on the server: reset and retry once.
				this.sessionId = null;
				await this.ensureSession();
				res = await this.search(input.query);
			}
			return this.interpret(res);
		} catch (error) {
			return err(
				`Web search failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async ensureSession(): Promise<void> {
		if (this.sessionId) return;
		const res = await this.post({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "arbetslag", version: "1.0.0" },
			},
		});
		if (res.status !== 200 || !res.sessionId) {
			throw new Error(
				`MCP initialize failed (HTTP ${res.status}): ${truncate(res.rawText)}`,
			);
		}
		this.sessionId = res.sessionId;
		const note = await this.post({
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
		if (note.status >= 400) {
			this.sessionId = null;
			throw new Error(
				`MCP initialized notification failed (HTTP ${note.status})`,
			);
		}
	}

	private search(query: string): Promise<RawResponse> {
		return this.post({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: SEARCH_TOOL,
				arguments: {
					query,
					objective: OBJECTIVE,
					numResults: this.numResults,
				},
			},
		});
	}

	private interpret(res: RawResponse): Result<WebSearchResult[], string> {
		if (res.status >= 400) {
			return err(`Web search failed: HTTP ${res.status} ${truncate(res.rawText)}`);
		}
		const message = res.message;
		if (!message) {
			return err(
				`Web search failed: no JSON-RPC message in response: ${truncate(res.rawText)}`,
			);
		}
		if (message.error) {
			return err(
				`Web search failed: MCP error ${message.error.code}: ${message.error.message}`,
			);
		}
		const result = message.result as ToolResult | undefined;
		const text = result?.content?.find((c) => c.type === "text")?.text;
		if (result?.isError) {
			return err(text ?? "Web search failed: Exa search error");
		}
		if (text === undefined) {
			return err("Web search failed: empty response from Exa");
		}
		return ok(parseSearchText(text));
	}

	private async post(body: unknown): Promise<RawResponse> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		};
		if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
		if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const res = await fetch(this.url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			const rawText = await this.readBody(res);
			return {
				status: res.status,
				sessionId: res.headers.get("mcp-session-id"),
				message: extractMessage(rawText, res.headers.get("content-type")),
				rawText,
			};
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Streamable HTTP bodies are either a single JSON document or an SSE
	 * stream. The server may keep an SSE stream open after the response
	 * message, so for SSE we stop reading once the JSON-RPC message arrived
	 * instead of waiting for EOF.
	 */
	private async readBody(res: Response): Promise<string> {
		const contentType = res.headers.get("content-type") ?? "";
		if (!contentType.includes("text/event-stream") || res.body == null) {
			return res.text();
		}
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
			buffer += decoder.decode(chunk, { stream: true });
			if (extractMessage(buffer, "text/event-stream")) break;
		}
		return buffer + decoder.decode();
	}
}
