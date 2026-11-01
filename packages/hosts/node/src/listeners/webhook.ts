import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import type { TriggerKindDefinition } from "@arbetslag/kernel";
import {
	type ListenerHandle,
	type ListenerHooks,
	type ListenerRuntime,
	ListenerUnready,
} from "./runtime.ts";

const anyJson: z.ZodType<JsonValue> = z.json();

/** 订阅一侧（触发器）的 config：只有输出名，它就是投给节点的消息类别（ADR-0005）。默认 `request`。 */
export type WebhookTriggerConfig = { output: string };

/** webhook 这种触发器：一个输出，载荷是任意 JSON。 */
export const webhookKind: TriggerKindDefinition<WebhookTriggerConfig> = {
	kind: "webhook",
	config: z.object({ output: z.string().min(1).default("request") }),
	outputs: (config) => ({ [config.output]: anyJson }),
};

/** 监听器一侧的 config：一个端口、一个路径，以及事件用哪个输出名交给路由（要与订阅一侧一致）。 */
export const webhookListenerConfig = z.object({
	/** 0 = 让系统挑一个（测试用）；实际端口从 handle 上读。 */
	port: z.number().int().min(0).max(65535),
	path: z.string().startsWith("/").default("/"),
	output: z.string().min(1).default("request"),
});

export type WebhookListenerConfig = z.infer<typeof webhookListenerConfig>;

export type WebhookHandle = ListenerHandle & { port: number; path: string };

export type WebhookOptions = {
	/** 监听地址；默认只听回环。对外开是部署的事。 */
	host?: string;
	/** body 上限，默认 1 MiB。 */
	maxBodyBytes?: number;
};

/**
 * 一个监听器一条 `http.Server`。请求头 `idempotency-key` 有值就当 `eventId`，路由按它去重。
 *
 * `open` 在 `listen` 成功之后才 resolve，端口被占等失败抛 `ListenerUnready`；
 * 监听成功之后再出错走 `hooks.unready`。事件写进发件箱之后才回 200（ADR-0015）。
 */
export function createWebhookRuntime(options: WebhookOptions = {}): ListenerRuntime<WebhookHandle> {
	const host = options.host ?? "127.0.0.1";
	const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

	return {
		kind: webhookKind.kind,

		open(listener, hooks) {
			const parsed = webhookListenerConfig.safeParse(listener.config);
			if (!parsed.success) {
				return Promise.reject(new ListenerUnready(listener.id, `invalid config: ${parsed.error.message}`));
			}
			const config = parsed.data;
			return new Promise<WebhookHandle>((resolve, reject) => {
				const server = createServer((request, response) => {
					void handle(config, hooks, maxBodyBytes, request, response);
				});

				server.once("error", (error) => reject(new ListenerUnready(listener.id, message(error))));

				server.listen(config.port, host, () => {
					const address = server.address();
					const port = typeof address === "object" && address !== null ? address.port : config.port;
					// 起起来了：之前的 error 处理器不再负责未就绪，换成事后故障上报。
					server.removeAllListeners("error");
					server.on("error", (error) => hooks.unready(message(error)));
					resolve({ port, path: config.path, close: () => close(server) });
				});
			});
		},
	};
}

async function handle(
	config: WebhookListenerConfig,
	hooks: ListenerHooks,
	maxBodyBytes: number,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	try {
		if (request.method !== "POST" || (request.url ?? "").split("?")[0] !== config.path) {
			response.writeHead(404).end();
			return;
		}
		const body = await readJson(request, maxBodyBytes);
		const key = request.headers["idempotency-key"];
		const eventId = typeof key === "string" && key !== "" ? key : undefined;
		await hooks.emit({ output: config.output, body, ...(eventId === undefined ? {} : { eventId }) });
		response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
	} catch (error) {
		// 没写进发件箱就不确认：调用方看到失败，自己决定重投。
		const status = error instanceof BodyError ? error.status : 503;
		response.writeHead(status, { "content-type": "application/json" }).end(
			JSON.stringify({ ok: false, error: message(error) }),
		);
	}
}

class BodyError extends Error {
	readonly status: number;

	constructor(status: number, reason: string) {
		super(reason);
		this.name = "BodyError";
		this.status = status;
	}
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<JsonValue> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > maxBodyBytes) throw new BodyError(413, "body too large");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") throw new BodyError(400, "empty body");
	try {
		return JSON.parse(text) as JsonValue;
	} catch {
		throw new BodyError(400, "body is not JSON");
	}
}

function close(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error === undefined ? resolve() : reject(error)));
	});
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
