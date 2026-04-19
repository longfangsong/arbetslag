import { z } from "zod";
import { Context } from "../context";
import { Session } from "../session";
import { Tool } from ".";

const HttpRequestInputSchema = z.object({
    url: z.string().describe("URL to make the request to."),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
        .optional()
        .describe("HTTP method to use."),
    headers: z.record(z.string(), z.string())
        .optional()
        .describe("HTTP headers to send with the request."),
    body: z.string().optional().describe("Request body to send (for POST, PUT, PATCH)."),
});

export { HttpRequestInputSchema };

export interface HttpResponse {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
}

class HttpRequest implements Tool<typeof HttpRequestInputSchema, HttpResponse> {
    static name: string = "httpRequest";
    description: string = "Make an HTTP request to a URL and get the response.";
    inputSchema = HttpRequestInputSchema;

    async handler(
        context: Context,
        session: Session,
        input: z.infer<typeof HttpRequestInputSchema>
    ): Promise<HttpResponse> {
        const url: string = input.url;
        const method: string = input.method ?? "GET";
        const headers = input.headers;
        const body = input.body;

        const fetchOptions: RequestInit = {
            method,
        };

        if (headers !== undefined) {
            fetchOptions.headers = new Headers(Object.entries(headers));
        }

        if (body && method !== "GET" && method !== "HEAD") {
            fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        const responseBody = await response.text();

        return {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: responseBody,
        };
    }
}

export { HttpRequest };