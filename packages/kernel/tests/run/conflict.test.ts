import assert from "node:assert/strict";
import { test } from "node:test";
import { Conflict, type SnapshotStore } from "../../src/snapshotStore.ts";
import { deliverToNode, run } from "../../src/run/index.ts";
import { deterministic, load, registry, setup } from "./fixtures.ts";

/** 在第 n 次 save 之前，让别人先写一次（模拟并发投递），把 revision 弄过期。 */
function interfering(store: SnapshotStore, id: string, times: number): SnapshotStore {
	let left = times;
	return {
		load: (i) => store.load(i),
		drop: (i) => store.drop(i),
		async save(i, snapshot, expected) {
			if (i === id && expected !== null && left > 0) {
				left--;
				await deliverToNode(store, id, "c", { type: "late", body: left });
			}
			return store.save(i, snapshot, expected);
		},
	};
}

test("a run that loses the race is thrown away and redone on the fresh snapshot", async () => {
	const { store, log, id } = await setup();
	await deliverToNode(store, id, "a", { type: "in", body: "x" });

	const result = await run(interfering(store, id, 1), registry, id, { log, ...deterministic() });
	assert.equal(result.status, "quiescent");

	const s = await load(store);
	assert.ok(Object.values(s.graph.nodeStates).every((n) => n.mailbox.length === 0), "the late message was processed too");
	assert.equal(
		log.entries.get(id)?.filter((e) => e.type === "transition").length,
		4,
		"only the committed attempt is logged: a,b,c plus the late message at c",
	);
});

test("after three lost races the conflict is thrown to the caller", async () => {
	const { store, id } = await setup();
	await deliverToNode(store, id, "a", { type: "in", body: "x" });
	await assert.rejects(run(interfering(store, id, 3), registry, id), (e: unknown) => e instanceof Conflict && e.reason === "stale");
});

test("deliver retries on a lost race and keeps both messages in order", async () => {
	const { store, id } = await setup();
	let first = true;
	const racing: SnapshotStore = {
		load: (i) => store.load(i),
		drop: (i) => store.drop(i),
		async save(i, snapshot, expected) {
			if (first && expected !== null) {
				first = false;
				await deliverToNode(store, id, "a", { type: "other", body: 1 });
			}
			return store.save(i, snapshot, expected);
		},
	};
	await deliverToNode(racing, id, "a", { type: "mine", body: 2 });
	const mailbox = (await load(store)).graph.nodeStates.a?.mailbox.map((m) => m.message.type);
	assert.deepEqual(mailbox, ["other", "mine"]);
});
