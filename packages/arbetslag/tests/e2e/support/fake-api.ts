import { vi } from "vitest";

export interface ApiCall {
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: unknown;
}

/** Mocked hosts, so a real one can never be reached by accident. */
export const MOCK_TELEGRAM_BASE = "https://telegram.test";
export const MOCK_CRON_BASE = "https://api.cron-job.org";
export const MOCK_CRON_JOB_ID = 421001;

/**
 * External-API mock. Every outbound call in the framework goes through global
 * `fetch`, so this is the single mock point for that layer: it records what the
 * system tried to do to the world and answers with canned payloads.
 *
 * Unregistered URL → throw. That is the executable form of the project rule
 * "only the LLM and the external API are mocked": an unmocked host fails the
 * test instead of quietly reaching the network.
 */
export class FakeApi {
	readonly calls: Array<ApiCall> = [];

	private readonly routes = new Map<RegExp, (call: ApiCall) => unknown>([
		// Telegram OutputRouter
		[/^https:\/\/telegram\.test\/bot[^/]+\/sendRichMessage$/, () => ({ ok: true })],

		// cron-job.org: create (PUT /jobs returns the jobId), update, delete
		[
			/^https:\/\/api\.cron-job\.org\/jobs$/,
			(call) => (call.method === "PUT" ? { jobId: MOCK_CRON_JOB_ID } : { ok: true }),
		],
		[/^https:\/\/api\.cron-job\.org\/jobs\/\d+$/, () => ({ ok: true })],
	]);

	install(): void {
		const impl = async (
			input: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			const url = new URL(
				typeof input === "string" ? input : input instanceof URL ? input : input.url,
			);
			const call: ApiCall = {
				method: init?.method ?? "GET",
				url: url.toString(),
				headers: (init?.headers as Record<string, string>) ?? undefined,
				body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
		 };
			this.calls.push(call);

			const handler = this.matchRoute(call.url);
			if (!handler) throw new Error(`FakeApi: unregistered request ${call.url}`);
			return new Response(JSON.stringify(handler(call)), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		};
		vi.stubGlobal("fetch", impl);
	}

	uninstall(): void {
		vi.unstubAllGlobals();
	}

	callsMatching(pattern: RegExp): Array<ApiCall> {
		return this.calls.filter((c) => pattern.test(c.url));
	}

	private matchRoute(url: string): ((call: ApiCall) => unknown) | undefined {
		for (const [pattern, handler] of this.routes) {
			pattern.lastIndex = 0;
			if (pattern.test(url)) return handler;
		}
		return undefined;
	}
}
