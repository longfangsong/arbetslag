import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { xxhash3 } from "hash-wasm";
import { chromium } from "playwright";

// x.com / twitter.com 403 headless browsers; route tweet links through the
// fxtwitter API which returns the tweet as JSON.
function rewriteXUrl(url: string): string {
	try {
		const u = new URL(url);
		const m = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status(?:es)?\/(\d+)/);
		if (m) return `https://api.fxtwitter.com/${m[1]}/status/${m[2]}`;
	} catch {
		// malformed URL — leave it as-is, goto will report the error
	}
	return url;
}

const FetchWebPageInputSchema = z.object({
	url: z.string().describe("URL of the web page to fetch."),
});

export interface WebPage {
	url: string;
	title: string;
	savedTo: string;
	/** Set when the original URL was rewritten (e.g. x.com → fxtwitter). */
	note?: string;
}

export class FetchWebPage
	implements Tool<z.infer<typeof FetchWebPageInputSchema>, WebPage, string>
{
	name: string = "fetch_web_page";
	description: string =
		"Fetch a web page with a headless browser (JavaScript rendered), the rendered text will be saved to a file.";
	inputSchema = FetchWebPageInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof FetchWebPageInputSchema>,
	): Promise<Result<WebPage, string>> {
		const { url } = input;
		const fileSystem = context.fileSystem;
		const fetchUrl = rewriteXUrl(url);
		let browser;
		try {
			browser = await chromium.launch({ headless: true });
			// A real Chrome user agent: some sites (e.g. openai.com) 403 the
		// default HeadlessChrome UA.
			const page = await browser.newPage({
				userAgent:
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
			});
			const response = await page.goto(fetchUrl, { waitUntil: "load", timeout: 30_000 });
			if (!response || response.status() >= 400) {
				return err(`Failed to fetch web page: ${response?.status() ?? "no response"}`);
			}
			const text = await page.locator("body").innerText();
			const title = await page.title();
			const savedFile = `web/${await xxhash3(text)}.txt`;
			await fileSystem.writeFile(savedFile, text);
			return ok({
				url: page.url(),
				title,
				savedTo: savedFile,
				note:
					fetchUrl !== url
						? `original URL ${url} blocked x.com (403), fetched via ${fetchUrl}`
						: undefined,
			});
		} catch (error) {
			return err(
				`Failed to fetch web page: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			await browser?.close().catch(() => {});
		}
	}
}
