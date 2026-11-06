import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { InstantiateError, WorkflowExists, type WorkflowTemplate } from "@arbetslag/kernel";
import type { Host } from "@arbetslag/host-node";
import type { JsonValue } from "type-fest";
import type {
	CreateRefusal,
	MonitorEvent,
	Overview,
	TemplateEntry,
	WorkflowDetail,
	WorkflowSummary,
} from "./protocol.ts";
import { summarize } from "./summary.ts";

/** 同一份工作流的变化在这段时间里合并成一次推送：观察回调跑在推进的路径上，序列化快照不能放在那里。 */
export const DEFAULT_COALESCE_MS = 100;
/** SSE 的保活注释间隔：比常见代理的空闲超时短。 */
const KEEPALIVE_MS = 15_000;
/** 上传的模板上限。 */
const MAX_BODY_BYTES = 1024 * 1024;

export type MonitorOptions = {
	host: Host;
	/** 默认 0：由系统挑一个空闲端口，看 `Monitor.url`。 */
	port?: number;
	/** 默认只绑本机：没有鉴权，对外暴露由部署方在前面加反向代理（ADR-0017）。 */
	hostname?: string;
	/** 前端构建产物的目录；默认是包里的 `dist/web`。 */
	assets?: string;
	coalesceMs?: number;
};

export type Monitor = {
	readonly url: string;
	/** 断开所有 SSE 连接、关掉端口。不碰宿主。 */
	close(): Promise<void>;
};

const MIME: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".json": "application/json",
	".woff2": "font/woff2",
};

class BadRequest extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BadRequest";
	}
}

function send(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) throw new BadRequest(`body is larger than ${MAX_BODY_BYTES} bytes`);
		chunks.push(chunk as Buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new BadRequest("body is not JSON");
	}
}

/**
 * 监控（ADR-0017）：和激活在同一个进程里，因为只有激活看得见工作副本、「正在执行」与「未就绪」，
 * 而存储文件被它独占（ADR-0014）。只读，唯一的写是用模板创建工作流。
 */
export async function createMonitor(options: MonitorOptions): Promise<Monitor> {
	const { host } = options;
	const assets = resolve(options.assets ?? fileURLToPath(new URL("./web/", import.meta.url))) + sep;
	const coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
	const clients = new Set<ServerResponse>();

	async function summaryOf(id: string): Promise<WorkflowSummary | undefined> {
		const snapshot = await host.snapshot(id);
		return snapshot === undefined ? undefined : summarize(id, snapshot, host.executing(id).length);
	}

	async function overview(): Promise<Overview> {
		const summaries = await Promise.all((await host.store.ids()).map(summaryOf));
		return {
			workflows: summaries.filter((summary) => summary !== undefined),
			unready: host.unready(),
		};
	}

	function broadcast(message: MonitorEvent): void {
		const frame = `event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`;
		for (const client of clients) client.write(frame);
	}

	// ── 变化 → 合并 → 推送 ─────────────────────────────────────────────────────

	const dirty = new Set<string>();
	let unreadyDirty = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function flush(): Promise<void> {
		timer = undefined;
		const ids = [...dirty];
		dirty.clear();
		const unready = unreadyDirty;
		unreadyDirty = false;
		for (const id of ids) {
			const summary = await summaryOf(id).catch(() => undefined);
			if (summary !== undefined) broadcast({ event: "workflow", data: summary });
		}
		if (unready) broadcast({ event: "unready", data: host.unready() });
	}

	const unwatch = host.watch((change) => {
		if (clients.size === 0) return;
		if (change.scope === "workflow") dirty.add(change.id);
		else unreadyDirty = true;
		timer ??= setTimeout(() => void flush(), coalesceMs);
	});

	// ── 路由 ───────────────────────────────────────────────────────────────────

	async function events(req: IncomingMessage, res: ServerResponse): Promise<void> {
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			connection: "keep-alive",
		});
		const keepalive = setInterval(() => res.write(": keepalive\n\n"), KEEPALIVE_MS);
		keepalive.unref();
		req.on("close", () => {
			clearInterval(keepalive);
			clients.delete(res);
		});
		// 先登记再取全量：取的期间发生的变化也会推过来，前端按 id 覆盖，不会丢。
		clients.add(res);
		const data = await overview();
		res.write(`event: overview\ndata: ${JSON.stringify(data)}\n\n`);
	}

	function templateEntries(): TemplateEntry[] {
		return Object.entries(host.templates)
			.filter((entry): entry is [string, WorkflowTemplate] => entry[1] !== undefined)
			.map(([name, template]) => ({ name, params: (template.params ?? {}) as Record<string, unknown>, template }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async function detail(res: ServerResponse, id: string): Promise<void> {
		const snapshot = await host.snapshot(id);
		if (snapshot === undefined) return send(res, 404, { code: "workflow_not_found", id });
		const executing = host.executing(id);
		const body: WorkflowDetail = { summary: summarize(id, snapshot, executing.length), snapshot, executing };
		send(res, 200, body);
	}

	async function create(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const body = await readJson(req);
		if (typeof body !== "object" || body === null || !("template" in body)) {
			throw new BadRequest("expected { template, id? }");
		}
		const { template, id, params } = body as { template: unknown; id?: unknown; params?: unknown };
		if (id !== undefined && (typeof id !== "string" || id.length === 0)) {
			throw new BadRequest("id must be a non-empty string");
		}
		if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
			throw new BadRequest("params must be an object");
		}
		// 一个名字：从部署的模板目录里取（ADR-0018）；否则是上传的整份模板。
		let resolved = template as WorkflowTemplate;
		if (typeof template === "string") {
			const found = host.templates[template];
			if (found === undefined) {
				return send(res, 400, { code: "template_unknown", name: template } satisfies CreateRefusal);
			}
			resolved = found;
		}
		try {
			const created = await host.create(resolved, {
				...(id === undefined ? {} : { id }),
				...(params === undefined ? {} : { params: params as Record<string, JsonValue> }),
			});
			send(res, 201, created);
		} catch (error) {
			if (error instanceof InstantiateError) {
				return send(res, 400, { code: "template_invalid", violations: error.violations } satisfies CreateRefusal);
			}
			if (error instanceof WorkflowExists) {
				return send(res, 409, { code: "workflow_exists", id: error.id } satisfies CreateRefusal);
			}
			throw error;
		}
	}

	async function asset(res: ServerResponse, pathname: string): Promise<void> {
		const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
		const file = join(assets, relative);
		const fallback = join(assets, "index.html");
		const target = extname(relative) === "" ? fallback : file;
		if (!target.startsWith(assets)) return send(res, 404, { code: "not_found" });
		try {
			const content = await readFile(target);
			res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
			res.end(content);
		} catch {
			send(res, 404, { code: "not_found" });
		}
	}

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const { pathname } = new URL(req.url ?? "/", "http://localhost");
		const method = req.method ?? "GET";
		const match = /^\/api\/workflows\/([^/]+)$/.exec(pathname);

		if (pathname === "/api/events" && method === "GET") return events(req, res);
		if (pathname === "/api/workflows" && method === "GET") return send(res, 200, await overview());
		if (pathname === "/api/templates" && method === "GET") return send(res, 200, templateEntries());
		if (pathname === "/api/workflows" && method === "POST") return create(req, res);
		if (match?.[1] !== undefined && method === "GET") return detail(res, decodeURIComponent(match[1]));
		if (pathname.startsWith("/api/")) return send(res, 404, { code: "not_found" });
		if (method === "GET") return asset(res, pathname);
		send(res, 405, { code: "method_not_allowed" });
	}

	const server = createServer((req, res) => {
		handle(req, res).catch((error: unknown) => {
			if (res.headersSent) {
				res.end();
				return;
			}
			if (error instanceof BadRequest) {
				send(res, 400, { code: "request_invalid", detail: error.message } satisfies CreateRefusal);
				return;
			}
			send(res, 500, { code: "internal_error" });
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, options.hostname ?? "127.0.0.1", () => resolve());
	});
	const address = server.address() as AddressInfo;
	const shown = address.family === "IPv6" ? `[${address.address}]` : address.address;

	return {
		url: `http://${shown}:${address.port}`,
		async close() {
			unwatch();
			if (timer !== undefined) clearTimeout(timer);
			for (const client of clients) client.end();
			clients.clear();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
