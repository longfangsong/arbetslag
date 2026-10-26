import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import type { TriggerKindDefinition } from "@arbetslag/kernel";
import {
	type TriggerHandle,
	type TriggerHooks,
	type TriggerRuntime,
	TriggerUnready,
} from "./runtime.ts";

const anyJson: z.ZodType<JsonValue> = z.json();

export type WebhookConfig = {
	/** 0 = 让系统挑一个（测试用）；实际端口从 handle 上读。 */
	port: number;
	path: string;
	/** 输出名 = 投给节点的消息类别（ADR-0001）。默认 `request`。 */
	output: string;
};

/** webhook 这种触发器：声明里就一个端口、一个路径。 */
export const webhookKind: TriggerKindDefinition<WebhookConfig> = {
	kind: "webhook",
	config: z.object({
		port: z.number().int().min(0).max(65535),
		path: z.string().startsWith("/").default("/"),
		output: z.string().min(1).default("request"),
	}),
	outputs: (config) => ({ [config.output]: anyJson }),
};

export type WebhookHandle = TriggerHandle & { port: number; path: string };

export type WebhookOptions = {
	/** 监听地址；默认只听回环。对外开是部署的事。 */
	host?: string;
	/** body 上限，默认 1 MiB。 */
	maxBodyBytes?: number;
};

/**
 * 一个触发器一条 `http.Server`：配置里带端口，起两个监听就是两个端口。
 *
 * `open` 在 `listen` 成功之后才 resolve，端口被占等失败抛 `TriggerUnready`
 * （→ 未就绪，宿主重试）；监听成功之后再出错（server 的 `error` 事件）走 `hooks.unready`。
 */
export function createWebhookRuntime(options: WebhookOptions = {}): TriggerRuntime<WebhookHandle> {
	const host = options.host ?? "127.0.0.1";
	const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

	return {
		kind: webhookKind.kind,

		open(declaration, hooks) {
			const parsed = webhookKind.config.safeParse(declaration.config);
			if (!parsed.success) {
				return Promise.reject(
					new TriggerUnready(declaration.id, `invalid config: ${parsed.error.message}`),
				);
			}
			const config = parsed.data;
			return new Promise<WebhookHandle>((resolve, reject) => {
				const server = createServer((request, response) => {
					void handle(declaration.id, config, hooks, maxBodyBytes, request, response);
				});

				server.once("error", (error) => reject(new TriggerUnready(declaration.id, message(error))));

				server.listen(config.port, host, () => {
					const address = server.address();
					const port = typeof address === "object" && address !== null ? address.port : config.port;
					// 起起来了：之前的 error 处理器不再负责未就绪，换成事后故障上报。
					server.removeAllListeners("error");
					server.on("error", (error) => hooks.unready(message(error)));
					const handle: WebhookHandle = {
						port,
						path: config.path,
						close: () => close(server),
					};
					resolve(handle);
				});
			});
		},
	};
}

async function handle(
	trigger: string,
	config: WebhookConfig,
	hooks: TriggerHooks,
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
		await hooks.deliver(config.output, body);
		response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
	} catch (error) {
		// 拒收不是故障：坏 body、坏消息、停住的工作流都如实回给调用方（ADR-0008）。
		const status = error instanceof BodyError ? error.status : 503;
		response.writeHead(status, { "content-type": "application/json" }).end(
			JSON.stringify({ ok: false, error: message(error), trigger }),
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
