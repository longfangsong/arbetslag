import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import { type WorkflowTemplate, createRegistry, defineNode } from "@arbetslag/kernel";
import { type Performers, createHost, createSqliteStore } from "@arbetslag/host-node";
import type { MonitorEvent, Overview, WorkflowDetail } from "../src/protocol.ts";
import { createMonitor } from "../src/server.ts";

const anyJson: z.ZodType<JsonValue> = z.json();

/** 收到 `go` 交出一个 `slow.call`，其余消息记下来。 */
const worker = defineNode({
	name: "worker",
	version: 1,
	state: z.object({ got: z.number() }).default({ got: 0 }),
	config: z.null(),
	ports: () => ({}),
	step: ({ state, message }) => {
		if (message.type === "go") {
			return { state, effects: [{ kind: "slow.call", input: message.body, correlationId: "c" }] };
		}
		return { state: { got: state.got + 1 } };
	},
});

const registry = createRegistry({
	nodes: [worker],
	effects: [{ kind: "slow.call", input: anyJson, result: anyJson }],
	triggers: [{ kind: "hook", config: z.object({}), outputs: () => ({ text: anyJson }) }],
});

const one: WorkflowTemplate = { nodes: { w: { definition: "worker", config: null } } };

function gate() {
	const waiting: (() => void)[] = [];
	const performers: Performers = {
		"slow.call": async (input) => {
			await new Promise<void>((resolve) => waiting.push(resolve));
			return { ok: true, input };
		},
	};
	return { performers, release: () => waiting.splice(0).forEach((resolve) => resolve()) };
}

/** 模板目录里的一份（ADR-0018）：参数 `label` 进节点的初始 state。 */
const labelled: WorkflowTemplate = {
	params: { label: 0 },
	nodes: { w: { definition: "worker", config: null, state: { got: "{{label}}" } } },
};

async function setup(performers: Performers = {}) {
	const assets = await mkdtemp(join(tmpdir(), "monitor-assets-"));
	await writeFile(join(assets, "index.html"), "<!doctype html><title>monitor</title>");
	const store = createSqliteStore({ file: ":memory:" });
	const host = createHost({ store, registry, performers, templates: { labelled }, onError: () => {} });
	const monitor = await createMonitor({ host, assets, coalesceMs: 5 });
	const api = (path: string, init?: RequestInit) => fetch(`${monitor.url}${path}`, init);
	const post = (body: unknown) =>
		api("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	return { store, host, monitor, api, post };
}

/** 读 SSE 帧，直到 `until` 认可为止。 */
async function readEvents(response: Response, until: (events: MonitorEvent[]) => boolean): Promise<MonitorEvent[]> {
	const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
	const events: MonitorEvent[] = [];
	let buffer = "";
	const deadline = setTimeout(() => void reader.cancel(), 2000);
	try {
		while (!until(events)) {
			const { value, done } = await reader.read();
			if (done) throw new Error(`stream ended; got ${JSON.stringify(events)}`);
			buffer += value;
			let end = buffer.indexOf("\n\n");
			while (end >= 0) {
				const frame = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				const event = /^event: (.+)$/m.exec(frame)?.[1];
				const data = /^data: (.+)$/m.exec(frame)?.[1];
				if (event !== undefined && data !== undefined) events.push({ event, data: JSON.parse(data) } as MonitorEvent);
				end = buffer.indexOf("\n\n");
			}
		}
	} finally {
		clearTimeout(deadline);
		await reader.cancel().catch(() => {});
	}
	return events;
}

test("binds to localhost unless told otherwise", async () => {
	const { monitor } = await setup();
	assert.match(monitor.url, /^http:\/\/127\.0\.0\.1:\d+$/);
	await monitor.close();
});

test("creating from an uploaded template shows up in the overview and the detail", async () => {
	const { monitor, api, post } = await setup();
	const created = await post({ template: one, id: "a" });
	assert.equal(created.status, 201);
	assert.deepEqual(await created.json(), { id: "a" });

	const overview = (await (await api("/api/workflows")).json()) as Overview;
	assert.deepEqual(overview.workflows.map((w) => [w.id, w.status, w.nodes]), [["a", "quiescent", 1]]);

	const detail = (await (await api("/api/workflows/a")).json()) as WorkflowDetail;
	assert.deepEqual(Object.keys(detail.snapshot.graph.shape.nodes), ["w"]);
	assert.equal((await api("/api/workflows/missing")).status, 404);
	await monitor.close();
});

test("a bad template, an existing id and a malformed body are refused with their own codes", async () => {
	const { monitor, post, api } = await setup();
	await post({ template: one, id: "a" });

	const exists = await post({ template: one, id: "a" });
	assert.equal(exists.status, 409);
	assert.deepEqual(await exists.json(), { code: "workflow_exists", id: "a" });

	const invalid = await post({ template: { nodes: { x: { definition: "nope", config: null } } } });
	assert.equal(invalid.status, 400);
	const refusal = (await invalid.json()) as { code: string; violations: { code: string }[] };
	assert.equal(refusal.code, "template_invalid");
	assert.ok(refusal.violations.length > 0);

	const malformed = await api("/api/workflows", { method: "POST", body: "{" });
	assert.equal(malformed.status, 400);
	assert.equal(((await malformed.json()) as { code: string }).code, "request_invalid");
	await monitor.close();
});

test("the event stream opens with the overview, then pushes the workflow as its effect goes out and comes back", async () => {
	const slow = gate();
	const { host, monitor, api, post } = await setup(slow.performers);
	await post({ template: one, id: "a" });

	const stream = await api("/api/events");
	assert.equal(stream.headers.get("content-type"), "text/event-stream; charset=utf-8");
	const pushing = readEvents(stream, (events) =>
		events.some((e) => e.event === "workflow" && e.data.status === "quiescent" && e.data.inFlight === 0),
	);
	// 等 overview 先到：之后的提交一定会被推送。
	await new Promise((resolve) => setTimeout(resolve, 20));
	await host.submit("a", "w", { type: "go", body: 1 });
	await new Promise((resolve) => setTimeout(resolve, 20));
	slow.release();
	await host.idle();

	const events = await pushing;
	assert.equal(events[0]?.event, "overview");
	assert.ok(
		events.some((e) => e.event === "workflow" && e.data.status === "in_flight" && e.data.executing === 1),
		JSON.stringify(events),
	);
	await monitor.close();
});

test("serves the web app, with index.html for client-side routes and no escape from the assets", async () => {
	const { monitor, api } = await setup();
	assert.equal((await api("/")).status, 200);
	assert.equal(await (await api("/workflows/a")).text(), "<!doctype html><title>monitor</title>");
	assert.equal((await api("/../../etc/passwd.txt")).status, 404);
	assert.equal((await api("/api/nope")).status, 404);
	await monitor.close();
});

test("the template directory is listed, and a workflow is created from it by name with params", async () => {
	const { monitor, api, post } = await setup();
	const entries = (await (await api("/api/templates")).json()) as { name: string; params: unknown }[];
	assert.deepEqual(
		entries.map((e) => [e.name, e.params]),
		[["labelled", { label: 0 }]],
	);

	const created = await post({ template: "labelled", id: "l", params: { label: 5 } });
	assert.equal(created.status, 201);
	const detail = (await (await api("/api/workflows/l")).json()) as WorkflowDetail;
	assert.deepEqual(detail.snapshot.graph.nodeStates.w?.state, { got: 5 });

	const unknown = await post({ template: "nope" });
	assert.equal(unknown.status, 400);
	assert.deepEqual(await unknown.json(), { code: "template_unknown", name: "nope" });

	const badParams = await post({ template: "labelled", params: { other: 1 } });
	assert.equal(badParams.status, 400);
	assert.equal(((await badParams.json()) as { code: string }).code, "template_invalid");
	await monitor.close();
});
