import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { xxhash3 } from "hash-wasm";
import { chromium } from "playwright";

const FetchWebPageInputSchema = z.object({
	url: z.string().describe("URL of the web page to fetch."),
});

export interface WebPage {
	url: string;
	title: string;
	savedTo: string;
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
		let browser;
		try {
			browser = await chromium.launch({ headless: true });
			const page = await browser.newPage();
			const response = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
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
