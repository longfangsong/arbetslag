import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { JsonValue } from "type-fest";
import { InputAdapter } from "../../abstraction/inputAdapter";

/**
 * Routes HTTP requests to a set of `WebhookInputAdapter`s by path.
 *
 * One instance owns one port. `listen` is idempotent; `close` releases the port.
 * The server is an explicit collaborator rather than a static on the adapter, so
 * whoever creates it can also shut it down.
 */
export class WebhookServer {
	private readonly adapters: Map<string, InputAdapter> = new Map();
	private server: Server | undefined;

	constructor(private readonly port: number) {}

	/**
	 * Claim `path` for `adapter`, rejecting a second owner instead of silently
	 * replacing the first one.
	 */
	register(path: string, adapter: InputAdapter): void {
		if (this.adapters.has(path)) {
			throw new Error(`Webhook path already claimed: ${path}`);
		}
		this.adapters.set(path, adapter);
	}

	listen(): void {
		if (this.server) return;
		this.server = createServer((request, response) => {
			void this.handle(request, response);
		});
		this.server.listen(this.port);
	}

	async close(): Promise<void> {
		const server = this.server;
		if (!server) return;
		this.server = undefined;
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}

	private async handle(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		const adapter = this.adapters.get(path);

		// Read the body before answering anything: replying while the request body
		// is still in flight makes the client see a reset instead of the status.
		let payload: JsonValue = null;
		let malformed = false;
		try {
			payload = await readJsonBody(request);
		} catch {
			malformed = true;
		}

		if (!adapter) {
			this.respond(response, 404, { error: `No adapter for ${path}` });
			return;
		}
		if (malformed) {
			this.respond(response, 400, { error: "Body must be valid JSON" });
			return;
		}

		// Backpressure: the channel is small, so 202 means the adapter accepted
		// the payload, not that the downstream work finished.
		await adapter.accept(payload);
		this.respond(response, 202, { accepted: true });
	}

	private respond(
		response: ServerResponse,
		status: number,
		body: JsonValue,
	): void {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	}
}

async function readJsonBody(request: IncomingMessage): Promise<JsonValue> {
	const chunks: Array<Buffer> = [];
	for await (const chunk of request) {
		chunks.push(Buffer.from(chunk as Uint8Array));
	}
	const body = Buffer.concat(chunks).toString("utf8");
	return body.trim() === "" ? null : (JSON.parse(body) as JsonValue);
}

export class WebhookInputAdapter extends InputAdapter {
	private readonly server: WebhookServer;

	/**
	 * The path is the only constructor argument a project file can hold; the
	 * server is supplied by whoever registered this class with the `Runtime`.
	 */
	readonly config: JsonValue;

	/** Claiming the path is the constructor's job; nothing else is global here. */
	constructor(server: WebhookServer, path: string) {
		super();
		this.server = server;
		this.config = { path };
		server.register(path, this);
	}

	/** Open the port (idempotent) the first time someone consumes the stream. */
	override [Symbol.asyncIterator](): AsyncIterator<JsonValue> {
		this.server.listen();
		return super[Symbol.asyncIterator]();
	}
}
