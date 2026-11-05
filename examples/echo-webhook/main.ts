/**
 * 复读机：webhook 收到什么，就原样说回去。整个部署里只有宿主、一个监听器和**监控**；
 * 工作流本身不在代码里——用 `echo.template.json` 在监控页面上传创建（ADR-0017）。
 *
 * - `POST http://127.0.0.1:8787/echo` 任意 JSON → 路由 → 订阅了监听器 `echo` 的每份工作流
 * - 复读节点交出 `echo.say`；它的 **Performer** 故意慢（`ECHO_DELAY_MS`，默认 3 秒），
 *   好在监控里看见**等回执**与「正在执行」。
 * - 存储是 `data/echo.sqlite`：重启之后工作流还在，没说完的话由**恢复扫描**重新交出去。
 */
import type { JsonValue } from "type-fest";
import { z } from "zod";
import { createRegistry, defineNode } from "@arbetslag/kernel";
import { createHost, createSqliteStore, createWebhookRuntime, webhookKind } from "@arbetslag/host-node";
import { createMonitor } from "@arbetslag/monitor";

const WEBHOOK_PORT = Number(process.env.PORT ?? 8787);
const MONITOR_PORT = Number(process.env.MONITOR_PORT ?? 8790);
const DELAY_MS = Number(process.env.ECHO_DELAY_MS ?? 3000);
/** 节点 state 里只留最近这么多条，快照不会无限长。 */
const KEEP = 20;

const anyJson: z.ZodType<JsonValue> = z.json();

/** 收到 `message` 就交出一次 `echo.say`；回执回来时记下说了什么。 */
const echo = defineNode({
	name: "echo",
	version: 1,
	state: z.object({ heard: z.number(), said: z.array(anyJson) }).default({ heard: 0, said: [] }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type === "message") {
			const heard = state.heard + 1;
			return {
				state: { ...state, heard },
				effects: [{ kind: "echo.say", input: message.body, correlationId: `echo:${heard}` }],
			};
		}
		if (message.type === "@effect.end") {
			const { result } = message.body as { result: JsonValue };
			return { state: { ...state, said: [...state.said, result].slice(-KEEP) } };
		}
		return { state };
	},
});

const registry = createRegistry({
	nodes: [echo],
	effects: [{ kind: "echo.say", input: anyJson, result: anyJson }],
	triggers: [webhookKind],
});

const store = createSqliteStore({ file: new URL("./data/echo.sqlite", import.meta.url).pathname });

const host = createHost({
	store,
	registry,
	performers: {
		"echo.say": async (input, { workflowId }) => {
			await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
			console.log(`🔁 [${workflowId}] ${JSON.stringify(input)}`);
			return input;
		},
	},
	listeners: [{ id: "echo", kind: "webhook", config: { port: WEBHOOK_PORT, path: "/echo", output: "message" } }],
	runtimes: { webhook: createWebhookRuntime() },
	retryMs: 1000,
	onUnready: (info) => console.log(`! 未就绪 ${info.scope === "listener" ? info.listener : info.trigger}：${info.reason}`),
});

const recovered = await host.start();
const monitor = await createMonitor({ host, port: MONITOR_PORT });

console.log(`工作流 ${recovered.scanned} 份（恢复时重新交出 ${recovered.redispatched} 个效果）`);
console.log(`监控    ${monitor.url}   ← 上传 echo.template.json 创建一份复读工作流`);
console.log(`webhook POST http://127.0.0.1:${WEBHOOK_PORT}/echo   例：curl -d '{"text":"hi"}' -H 'content-type: application/json' http://127.0.0.1:${WEBHOOK_PORT}/echo`);

process.once("SIGINT", () => {
	void (async () => {
		await host.stop();
		await monitor.close();
		store.close();
		process.exit(0);
	})();
});
