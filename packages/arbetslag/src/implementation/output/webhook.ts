import type { JsonValue } from "type-fest";
import { OutputAdapter } from "../../abstraction/outputAdapter";

export type WebhookDeliveryOptions = {
	/** HTTP method used for delivery. Defaults to `POST`. */
	method?: string;
	/** Extra request headers. `content-type: application/json` is always sent. */
	headers?: Record<string, string>;
	/**
	 * Abort the request after this many milliseconds. Defaults to 30s: without a
	 * deadline a hanging endpoint would stall the graph's delivery loop forever.
	 */
	timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/** How much of an error response body is quoted in the thrown error. */
const MAX_ERROR_BODY = 500;

/**
 * Delivers graph output to a fixed URL as a JSON request.
 *
 * `send` resolves once the endpoint answered 2xx. Anything else throws, so a
 * doomed delivery surfaces through `Project` instead of being retried silently;
 * adding retries is the caller's decision, not a hidden policy here.
 */
export class WebhookOutputAdapter extends OutputAdapter {
	/** Everything a project file needs to rebuild this node: it is all data. */
	readonly config: JsonValue;

	private readonly url: string;
	private readonly options: WebhookDeliveryOptions;

	constructor(url: string, options: WebhookDeliveryOptions = {}) {
		super();
		this.url = url;
		this.options = options;
		this.config = { url, options };
	}

	async send(payload: JsonValue): Promise<void> {
		const response = await fetch(this.url, {
			method: this.options.method ?? "POST",
			headers: {
				"content-type": "application/json",
				...this.options.headers,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});
		// Read the body either way: it drains the response, and on failure it gives
		// the error message something concrete to quote.
		const body = await response.text();
		if (!response.ok) {
			throw new Error(
				`Webhook delivery to ${this.url} failed: ${response.status} ${response.statusText} ${
					body.slice(0, MAX_ERROR_BODY)
				}`.trim(),
			);
		}
	}
}
