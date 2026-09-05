import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const WebSearchInputSchema = z
	.object({
		query: z.string().describe("Search query string."),
		page: z
			.number()
			.int()
			.positive()
			.optional()
			.describe("1-based page number for pagination."),
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
	implements Tool<z.infer<typeof WebSearchInputSchema>, WebSearchResult[], string>
{
	private readonly searxngUrl: string;
	private readonly timeoutMs: number;
	private readonly maxResults: number;

	name: string = "web_search";
	description: string =
		"Search the web using a SearXNG instance and return matching results.";
	inputSchema = WebSearchInputSchema;

	constructor(
		searxngUrl: string,
		timeoutMs = 30000,
		maxResults = 10,
	) {
		this.searxngUrl = searxngUrl.replace(/\/$/, "");
		this.timeoutMs = timeoutMs;
		this.maxResults = maxResults;
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof WebSearchInputSchema>,
	): Promise<Result<WebSearchResult[], string>> {
		const params = new URLSearchParams({ q: input.query, format: "json" });
		if (input.page && input.page > 1) {
			params.set("page", String(input.page));
		}

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
