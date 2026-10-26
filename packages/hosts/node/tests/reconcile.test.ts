import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import { z } from "zod";
import {
	type Snapshot,
	type Trigger,
	type TriggerKindDefinition,
	createMemoryStore,
	createRegistry,
	createWorkflow,
	defineNode,
} from "@arbetslag/kernel";
import { createTriggers } from "../src/reconcile.ts";
import { type TriggerHandle, type TriggerRuntime, TriggerUnready } from "../src/triggers/runtime.ts";

const anyJson: z.ZodType<JsonValue> = z.json();

const sink = defineNode({
	name: "sink",
	version: 1,
	state: z.object({}).default({}),
	config: z.null(),
	ports: () => ({}),
	step: ({ state }) => ({ state }),
});

const fakeKind: TriggerKindDefinition = {
	kind: "fake",
	config: z.object({ n: z.number() }),
	outputs: () => ({ ping: anyJson }),
};

const registry = createRegistry({ nodes: [sink], effects: [], triggers: [fakeKind] });

const template = (triggers: Trigger[]) => ({
	nodes: { a: { definition: "sink", config: null } },
	triggers,
});

/** 记下每次 open / close，可以预置前 N 次失败。 */
function fakeRuntime(options: { failures?: number } = {}) {
	const events: string[] = [];
	let failures = options.failures ?? 0;
	const handles: { id: string; closed: boolean }[] = [];
	const runtime: TriggerRuntime = {
		kind: "fake",
		async open(declaration) {
			events.push(`open ${declaration.id} ${JSON.stringify(declaration.config)}`);
			if (failures > 0) {
				failures--;
				throw new TriggerUnready(declaration.id, "port busy");
			}
			const handle = {
				id: declaration.id,
				closed: false,
				async close() {
					handle.closed = true;
					events.push(`close ${declaration.id}`);
				},
			};
			handles.push(handle);
			return handle;
		},
	};
	return { runtime, events, handles };
}

const hook = (n: number): Trigger => ({ id: "hook", kind: "fake", config: { n } });

async function setup(triggers: Trigger[], id = "w") {
	const store = createMemoryStore();
	await createWorkflow(store, registry, template(triggers), { id });
	return store;
}

async function setTriggers(store: ReturnType<typeof createMemoryStore>, triggers: Trigger[], id = "w") {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new Error("missing workflow");
	const snapshot: Snapshot = {
		...loaded.snapshot,
		graph: { ...loaded.snapshot.graph, shape: { ...loaded.snapshot.graph.shape, triggers } },
	};
	await store.save(id, snapshot, loaded.revision);
}

const noDeliver = async () => null;

test("reconcile opens what the snapshot declares, and a second pass opens nothing", async () => {
	const store = await setup([hook(1)]);
	const { runtime, events } = fakeRuntime();
	const triggers = createTriggers({ store, runtimes: { fake: runtime }, deliver: noDeliver });

	const first = await triggers.reconcile("w");
	assert.deepEqual(first?.opened, ["hook"]);
	assert.deepEqual(triggers.running("w"), ["hook"]);

	const second = await triggers.reconcile("w");
	assert.deepEqual(second, { opened: [], reopened: [], closed: [], unready: [] });
	assert.deepEqual(events, ['open hook {"n":1}'], "an unchanged declaration is not reopened");
});

test("a changed declaration is closed and rebuilt", async () => {
	const store = await setup([hook(1)]);
	const { runtime, events, handles } = fakeRuntime();
	const triggers = createTriggers({ store, runtimes: { fake: runtime }, deliver: noDeliver });

	await triggers.reconcile("w");
	await setTriggers(store, [hook(2)]);
	const sync = await triggers.reconcile("w");

	assert.deepEqual(sync?.reopened, ["hook"]);
	assert.equal(handles[0]?.closed, true, "the old handle was closed");
	assert.equal(handles[1]?.closed, false, "the new one is open");
	assert.deepEqual(events, ['open hook {"n":1}', "close hook", 'open hook {"n":2}']);
});

test("a trigger removed from the shape is closed", async () => {
	const store = await setup([hook(1)]);
	const { runtime } = fakeRuntime();
	const triggers = createTriggers({ store, runtimes: { fake: runtime }, deliver: noDeliver });

	await triggers.reconcile("w");
	await setTriggers(store, []);
	const sync = await triggers.reconcile("w");

	assert.deepEqual(sync?.closed, ["hook"]);
	assert.deepEqual(triggers.running("w"), []);
});

test("a trigger that cannot open is unready, and the next sync retries it", async () => {
	const store = await setup([hook(1)]);
	const { runtime } = fakeRuntime({ failures: 1 });
	const unready: string[] = [];
	const triggers = createTriggers({
		store,
		runtimes: { fake: runtime },
		deliver: noDeliver,
		onUnready: (info) => unready.push(`${info.trigger}: ${info.reason}`),
	});

	const sync = await triggers.reconcile("w");
	assert.deepEqual(sync?.unready, [{ trigger: "hook", reason: "port busy" }]);
	assert.deepEqual(unready, ["hook: port busy"], "未就绪 is reported, not thrown");
	assert.deepEqual(triggers.running("w"), []);
	assert.deepEqual(triggers.unready("w"), [{ trigger: "hook", reason: "port busy" }]);

	const retried = await triggers.reconcile("w");
	assert.deepEqual(retried?.opened, ["hook"]);
	assert.deepEqual(triggers.unready("w"), [], "未就绪 goes away once it opens");
	assert.deepEqual(triggers.running("w"), ["hook"]);
});

test("with retryMs set, an unready trigger is retried on its own", async () => {
	const store = await setup([hook(1)]);
	const { runtime } = fakeRuntime({ failures: 2 });
	const triggers = createTriggers({
		store,
		runtimes: { fake: runtime },
		deliver: noDeliver,
		retryMs: 5,
	});

	await triggers.reconcile("w");
	assert.deepEqual(triggers.running("w"), []);

	const deadline = Date.now() + 2000;
	while (triggers.running("w").length === 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.deepEqual(triggers.running("w"), ["hook"], "the retry timer rebuilt the listener");
	await triggers.stop();
});

test("a kind this deployment does not implement is unready, not a crash", async () => {
	const store = await setup([hook(1)]);
	const triggers = createTriggers({ store, runtimes: {}, deliver: noDeliver });

	const sync = await triggers.reconcile("w");
	assert.deepEqual(sync?.unready, [{ trigger: "hook", reason: 'no runtime for kind "fake"' }]);
});

test("a dropped workflow has its listeners closed", async () => {
	const store = await setup([hook(1)]);
	const { runtime, handles } = fakeRuntime();
	const triggers = createTriggers({ store, runtimes: { fake: runtime }, deliver: noDeliver });

	await triggers.reconcile("w");
	await store.drop("w");
	assert.equal(await triggers.reconcile("w"), undefined);
	assert.equal(handles[0]?.closed, true);
	assert.deepEqual(triggers.running("w"), []);
});

test("stop closes every listener", async () => {
	const store = await setup([hook(1)]);
	const { runtime, handles } = fakeRuntime();
	const triggers = createTriggers({ store, runtimes: { fake: runtime }, deliver: noDeliver });

	await triggers.reconcile("w");
	await triggers.stop();

	assert.ok(handles.every((handle) => handle.closed));
	assert.deepEqual(triggers.running("w"), []);
});

test("a listener that dies after opening is unready and rebuilt", async () => {
	const store = await setup([hook(1)]);
	let hooks: { unready: (reason: string) => void } | undefined;
	const runtime: TriggerRuntime = {
		kind: "fake",
		async open(_declaration, opened): Promise<TriggerHandle> {
			hooks = opened;
			return { close: async () => {} };
		},
	};
	const triggers = createTriggers({ store, runtimes: { fake: runtime }, deliver: noDeliver });

	await triggers.reconcile("w");
	hooks?.unready("socket closed");
	assert.deepEqual(triggers.running("w"), [], "the dead handle is dropped");
	assert.deepEqual(triggers.unready("w"), [{ trigger: "hook", reason: "socket closed" }]);
});
