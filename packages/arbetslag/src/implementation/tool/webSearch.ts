import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

// Rate limit state is process-global: a single `lastSearchAt` shared by all
// WebSearch instances, so any two search requests in the process are spaced
// at least rateLimitMinMs..rateLimitMaxMs apart.
let lastSearchAt = 0;

async function awaitSearchRateLimit(minMs: number, maxMs: number): Promise<void> {
	const intervalMs =
		minMs + Math.round(Math.random() * (maxMs - minMs));
	const waitMs = lastSearchAt + intervalMs - Date.now();
	if (waitMs > 0) {
		await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
	}
	lastSearchAt = Date.now();
}

export const WebSearchInputSchema = z
	.object({
		query: z.string().describe("Search query string.")
	})
	.describe("Search the web through a SearXNG instance.");

export interface WebSearchResult {
	title: string;
	url: string;
	content: string;
	engine?: string;
	score?: number;
	category?: string;
}

export class WebSearch
	implements Tool<z.infer<typeof WebSearchInputSchema>, WebSearchResult[], string> {
	private readonly searxngUrl: string;
	private readonly timeoutMs: number;
	private readonly maxResults: number;
	private readonly rateLimitMinMs: number;
	private readonly rateLimitMaxMs: number;

	name: string = "web_search";
	description: string =
		"Search the web using a SearXNG instance and return matching results. Search requests are rate limited: each search must be sent a random 10-20s after the previous one (globally, for all search requests in this process), and will block until the interval is satisfied.";
	inputSchema = WebSearchInputSchema;

	constructor(
		searxngUrl: string,
		timeoutMs = 30_000,
		maxResults = 10,
		rateLimitMinMs = 10_000,
		rateLimitMaxMs = 20_000,
	) {
		this.searxngUrl = searxngUrl.replace(/\/$/, "");
		this.timeoutMs = timeoutMs;
		this.maxResults = maxResults;
		this.rateLimitMinMs = rateLimitMinMs;
		this.rateLimitMaxMs = rateLimitMaxMs;
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof WebSearchInputSchema>,
	): Promise<Result<WebSearchResult[], string>> {
		await awaitSearchRateLimit(this.rateLimitMinMs, this.rateLimitMaxMs);
		const params = new URLSearchParams({ 
			q: input.query, 
			category_general: "1", 
			pageno: "1",
			language: "auto", 
			safesearch: "0", 
			format: "json" 
		});

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);

		try {
			const res = await fetch(
				`${this.searxngUrl}/search?${params.toString()}`,
				{ signal: controller.signal },
			);
			if (!res.ok) {
				return err(`SearXNG request failed: ${res.status} ${res.statusText}`);
			}

			const data = (await res.json()) as {
				results?: Array<Record<string, unknown>>;
			};

			const results = (data.results ?? [])
				.slice(0, this.maxResults)
				.map((r) => ({
					title: typeof r.title === "string" ? r.title : "",
					url: typeof r.url === "string" ? r.url : "",
					content: typeof r.content === "string" ? r.content : "",
					engine: typeof r.engine === "string" ? r.engine : undefined,
					score: typeof r.score === "number" ? r.score : undefined,
					category: typeof r.category === "string" ? r.category : undefined,
				}));

			return ok(results);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return err(`Web search failed: ${message}`);
		} finally {
			clearTimeout(timer);
		}
	}

}
