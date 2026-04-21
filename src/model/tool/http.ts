import { z } from "zod";
import { Context } from "../context";
import { Session } from "../session";
import { Tool } from ".";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

const DEFAULT_MAX_BODY_LENGTH = 4096;

const HttpRequestInputSchema = z.object({
  url: z.string().describe("URL to make the request to."),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
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
  maxBodyLength: z
    .number()
    .optional()
    .describe(
      "Maximum response body length to return inline. Larger responses are saved to a file. Default: 4096.",
    ),
});

export { HttpRequestInputSchema };

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyLength: number;
  savedFile?: string;
}

class HttpRequest implements Tool<typeof HttpRequestInputSchema, HttpResponse> {
  static name: string = "httpRequest";
  description: string = "Make an HTTP request to a URL and get the response.";
  inputSchema = HttpRequestInputSchema;

  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof HttpRequestInputSchema>,
  ): Promise<HttpResponse> {
    const url: string = input.url;
    const method: string = input.method ?? "GET";
    const headers = input.headers;
    const body = input.body;
    const maxBodyLength = input.maxBodyLength ?? DEFAULT_MAX_BODY_LENGTH;

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

    const result: HttpResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyLength: responseBody.length,
      body: responseBody,
    };

    if (responseBody.length > maxBodyLength) {
      const filename = `http/${Date.now()}_${nanoid()}.txt`;
      await context.fileSystem.writeFile(filename, responseBody);
      result.savedFile = filename;
      result.body = `[Response saved to ${filename}] (${responseBody.length} chars total)`;
    }

    return result;
  }
}

export { HttpRequest };
