import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { xxhash3 } from "hash-wasm";

export enum HttpMethod {
	GET = "GET",
	POST = "POST",
	PUT = "PUT",
	DELETE = "DELETE",
	PATCH = "PATCH",
	HEAD = "HEAD",
	OPTIONS = "OPTIONS",
}

const HttpRequestInputSchema = z.object({
	url: z.string().describe("URL to make the request to."),
	method: z
		.enum(Object.values(HttpMethod) as [string, ...string[]])
		.optional()
		.describe("HTTP method to use."),
	headers: z
		.record(z.string(), z.string())
		.optional()
		.describe("HTTP headers to send with the request."),
	body: z
		.string()
		.optional()
		.describe("Request body to send (for POST, PUT, PATCH)."),
});

export interface HttpResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	savedTo: string;
}

export class HttpRequest
	implements Tool<z.infer<typeof HttpRequestInputSchema>, HttpResponse, string>
{
	name: string = "http_request";
	description: string =
		"Make an HTTP request to a URL, the response will be saved to a file.";
	inputSchema = HttpRequestInputSchema;

	async call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof HttpRequestInputSchema>,
	): Promise<Result<HttpResponse, string>> {
		const { url, method = "GET", headers, body } = input;
		const fileSystem = context.fileSystem;
		try {
			const response = await fetch(url, {
				method,
				headers,
				body,
			});
			const responseHeaders: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				responseHeaders[key] = value;
			});
			const responseBody = await response.text();
			const bodyHash = xxhash3(responseBody);
			const savedFile = `http/${bodyHash}.bin`;
			await fileSystem.writeFile(savedFile, responseBody);
			return ok({
				status: response.status,
				statusText: response.statusText,
				headers: responseHeaders,
				savedTo: savedFile,
			});
		} catch (error) {
			return err(
				`Failed to make HTTP request: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
