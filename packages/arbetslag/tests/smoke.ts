import type { JsonValue } from "type-fest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { Project } from "../src/project";
import { Runtime } from "../src/index";
import { UserFunction } from "../src/abstraction/userFunction";
import { InputAdapter } from "../src/abstraction/inputAdapter";
import { OutputAdapter } from "../src/abstraction/outputAdapter";
import { CompletionAPI, type CompletionRequest } from "../src/abstraction/completion";
import { Tool } from "../src/abstraction/tool";
import type { ToolMetadata } from "../src/abstraction/tool";
import type { CompletionResult, History } from "../src/history";
import type { Store } from "../src/abstraction/store";
import { WebhookInputAdapter, WebhookServer } from "../src/implementation/input/webhook";
import { WebhookOutputAdapter } from "../src/implementation/output/webhook";

class MemoryStore implements Store {
	private readonly data = new Map<string, string>();
	async set(key: string, value: string): Promise<void> {
		this.data.set(key, value);
	}
	async get(key: string): Promise<string | undefined> {
		return this.data.get(key);
	}
}

class Double extends UserFunction {
	function = async (input: JsonValue): Promise<JsonValue> => ({
		doubled: (input as { n: number }).n * 2,
	});
}

class Exploding extends UserFunction {
	function = async (): Promise<JsonValue> => {
		throw new Error("boom");
	};
}

class ManualInput extends InputAdapter {
	push(payload: JsonValue): Promise<void> {
		return this.accept(payload);
	}
}

class RecordingOutput extends OutputAdapter {
	readonly seen: Array<JsonValue> = [];
	async send(payload: JsonValue): Promise<void> {
		await new Promise((r) => setTimeout(r, 0)); // 模拟慢下游，验证背压被 await
		this.seen.push(payload);
	}
}

class EchoCompletion extends CompletionAPI {
	readonly id: string = "echo";
	async complete(history: History, _tools: Array<ToolMetadata>): Promise<CompletionResult> {
		return { role: "assistant", content: `entries:${history.entries.length}` };
	}
}

class NoopTool extends Tool<null, null> {
	readonly id: string = "noop";
	description = "does nothing";
	inputSchema = z.null();
	async call(): Promise<null> {
		return null;
	}
}

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(`FAILED: ${message}`);
	console.log(`  ok  ${message}`);
}

/** 1. Actor 的 send -> process -> 输出流 */
async function actorRoundTrip(): Promise<void> {
	const actor = new Double();
	const first = (async () => {
		for await (const out of actor) return out;
		return undefined;
	})();
	await actor.send({ n: 21 });
	assert(JSON.stringify(await first) === '{"doubled":42}', "Actor: send 进 -> 结果从 for await 流出");
	await actor.stop();
}

/** 2. process 抛错 -> 下游 for await 抛出，而不是永久挂住 */
async function errorPropagates(): Promise<void> {
	const actor = new Exploding();
	const done = (async () => {
		try {
			for await (const _ of actor) {
				// 不应有输出
			}
			return "ended quietly";
		} catch (error) {
			return `threw: ${(error as Error).message}`;
		}
	})();
	await actor.send(null);
	const result = await Promise.race([
		done,
		new Promise((r) => setTimeout(() => r("hung"), 500)),
	]);
	assert(result === "threw: boom", "Actor: process 抛错传播到下游迭代器（不挂死）");
}

/** 3. InputAdapter：accept -> start；stop 让流结束 */
async function inputAdapterLifecycle(): Promise<void> {
	const input = new ManualInput();
	const collected: Array<JsonValue> = [];
	const consumer = (async () => {
		for await (const payload of input) collected.push(payload);
	})();
	await input.push(1);
	await input.push(2);
	await input.stop();
	await consumer;
	assert(JSON.stringify(collected) === "[1,2]", "InputAdapter: accept 的 payload 全量流出");

	let rejected = false;
	await input.push(3).catch(() => {
		rejected = true;
	});
	assert(rejected, "InputAdapter: stop 之后 accept 会 reject（不是永久挂住）");
}

/** 4. 整图：input -> userFunction -> output，且 deliver 等待下游 */
async function wholeGraph(): Promise<void> {
	const runtime = new Runtime(new MemoryStore());
	const input = new ManualInput();
	const double = new Double();
	const output = new RecordingOutput();
	runtime.register(input);
	runtime.register(double);
	runtime.register(output);

	const project = new Project();
	project.register(input);
	project.register(double);
	project.register(output);
	project.connect(input, double);
	project.connect(double, output);

	const running = project.start(runtime);
	await input.push({ n: 5 });
	await input.push({ n: 7 });
	await project.stop();
	await running;

	assert(
		JSON.stringify(output.seen) === '[{"doubled":10},{"doubled":14}]',
		"Project: input -> userFunction -> output 全链路按序到达",
	);
}

/** 5. 第二个消费者是显式报错，不是静默瓜分消息 */
async function doubleStart(): Promise<void> {
	const actor = new Double();
	actor[Symbol.asyncIterator]();
	let threw = false;
	try {
		actor[Symbol.asyncIterator]();
	} catch {
		threw = true;
	}
	assert(threw, "Actor: 第二次迭代显式报错（不起第二个消费者）");
	await actor.stop();
}

/** 6. webhook：端口真的绑上、path 冲突报错、坏 JSON 400、payload 流出来 */
async function webhook(): Promise<void> {
	const port = 30000 + Math.floor(Math.random() * 20000);
	const server = new WebhookServer(port);
	const input = new WebhookInputAdapter(server, "/hooks/thing");

	let duplicateRejected = false;
	try {
		new WebhookInputAdapter(server, "/hooks/thing");
	} catch {
		duplicateRejected = true;
	}
	assert(duplicateRejected, "WebhookServer: 同一 path 二次认领报错");

	const seen: Array<JsonValue> = [];
	const consuming = (async () => {
		for await (const payload of input) seen.push(payload);
	})();

	const base = `http://127.0.0.1:${port}`;
	const post = (path: string, body: string) => fetch(`${base}${path}`, { method: "POST", body });

	const accepted = await post("/hooks/thing", JSON.stringify({ hello: "world" }));
	assert(accepted.status === 202, "WebhookServer: 端口真的在 listen，合法请求 202");
	const missing = await post("/nope", "{}");
	assert(missing.status === 404, "WebhookServer: 未认领的 path 返回 404");
	const bad = await post("/hooks/thing", "not json");
	assert(bad.status === 400, "WebhookServer: 非法 JSON 返回 400");

	await new Promise((resolve) => setTimeout(resolve, 20));
	await input.stop();
	await consuming;
	await server.close();
	assert(
		JSON.stringify(seen) === '[{"hello":"world"}]',
		"WebhookInputAdapter: HTTP payload 从输出流流出（不再经 process 空转）",
	);
}

/** 7. 出站 webhook：真的发 HTTP、非 2xx 抛错、Runtime 认得出是 output */
async function webhookOutput(): Promise<void> {
	const port = 30000 + Math.floor(Math.random() * 20000);
	const server = new WebhookServer(port);
	// 拿输入侧当中转接收端，顺带验证两端能配上对。
	const sink = new WebhookInputAdapter(server, "/sink");
	const received: Array<JsonValue> = [];
	const consuming = (async () => {
		for await (const payload of sink) received.push(payload);
	})();

	const out = new WebhookOutputAdapter(`http://127.0.0.1:${port}/sink`);
	await out.send({ hello: "out" });
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert(
		JSON.stringify(received) === '[{"hello":"out"}]',
		"WebhookOutputAdapter: payload 递到目标 URL",
	);

	const unclaimed = new WebhookOutputAdapter(`http://127.0.0.1:${port}/unclaimed`);
	const failure = await unclaimed.send({ nope: true }).then(
		() => "",
		(error: Error) => error.message,
	);
	assert(failure.includes("404"), "WebhookOutputAdapter: 非 2xx 抛错并带上状态码");

	const runtime = new Runtime(new MemoryStore());
	runtime.register(out);
	assert(runtime.outputs.includes(out), "Runtime: WebhookOutputAdapter 被识别为 output");

	// 不响应的 endpoint 不能把投递循环永久卡死。
	const hanging = createServer(() => {});
	await new Promise<void>((resolve) => hanging.listen(0, resolve));
	const hangingPort = (hanging.address() as AddressInfo).port;
	const slow = new WebhookOutputAdapter(`http://127.0.0.1:${hangingPort}/x`, { timeoutMs: 50 });
	const timedOut = await slow.send({}).then(
		() => "",
		(error: Error) => error.name,
	);
	assert(timedOut === "TimeoutError", "WebhookOutputAdapter: 卡住的 endpoint 会在 timeoutMs 后被中止");
	hanging.closeAllConnections();
	await new Promise<void>((resolve) => hanging.close(() => resolve()));

	await sink.stop();
	await consuming;
	await server.close();
}

/** 8. 同一个类的多个实例可以各自是独立的节点 */
async function sameClassInstances(): Promise<void> {
	const first = new ManualInput();
	const second = new ManualInput();
	const sink = new RecordingOutput();
	assert(first.id !== second.id, "InputAdapter: 同一类的两个实例 id 不同（不再靠子类手写）");

	const runtime = new Runtime(new MemoryStore());
	const project = new Project();
	for (const node of [first, second, sink]) {
		runtime.register(node);
		project.register(node);
	}
	project.connect(first, sink);
	project.connect(second, sink);

	const running = project.start(runtime);
	await first.push({ from: "first" });
	await second.push({ from: "second" });
	await project.stop();
	await running;

	assert(
		JSON.stringify(sink.seen) === '[{"from":"first"},{"from":"second"}]',
		"Project: 同类两个 input 各自独立路由到同一个 output",
	);
}

/** 9. kind 是字段、id 是纯 nanoid；tool / api 是运行时实现，不是图节点 */
async function identityAndKinds(): Promise<void> {
	const input = new ManualInput();
	const sibling = new ManualInput();
	assert(input.id !== sibling.id, "id: 同类两实例不同");
	assert(!input.id.includes(":"), "id: 纯 nanoid，不再编码类型前缀");
	assert(input.kind === "input", "kind: 由基类声明，不靠 id 解析");

	const project = new Project();
	project.register(input);
	let duplicate = false;
	try {
		project.register(input);
	} catch {
		duplicate = true;
	}
	assert(duplicate, "Project.register: 重复 id 报错");

	const runtime = new Runtime(new MemoryStore());
	const api = new EchoCompletion();
	runtime.register(api);
	assert(runtime.completionAPIs.includes(api), "Runtime: CompletionAPI 按 kind 注册");
	let apiDuplicate = false;
	try {
		runtime.register(new EchoCompletion());
	} catch {
		apiDuplicate = true;
	}
	assert(apiDuplicate, "Runtime: 同 id 的实现重复注册报错");

	if (false) {
		// @ts-expect-error Tool 是运行时实现，kind 不在 NodeKind 里，不能当节点连
		project.connect(new NoopTool(), input);
	}
}

await actorRoundTrip();
await errorPropagates();
await inputAdapterLifecycle();
await wholeGraph();
await doubleStart();
await webhook();
await webhookOutput();
await sameClassInstances();
await identityAndKinds();
console.log("\nall smoke checks passed");
