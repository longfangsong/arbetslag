import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeyedQueue } from "../src/queue.ts";

/** 让出一轮事件循环，好让排队中的 work 有机会插进来。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("work on one key runs one at a time, in arrival order", async () => {
	const queue = createKeyedQueue();
	const events: string[] = [];

	const work = (name: string) => async () => {
		events.push(`start ${name}`);
		await tick();
		events.push(`end ${name}`);
		return name;
	};

	const results = await Promise.all([
		queue.add("w", work("a")),
		queue.add("w", work("b")),
		queue.add("w", work("c")),
	]);

	assert.deepEqual(results, ["a", "b", "c"]);
	assert.deepEqual(events, ["start a", "end a", "start b", "end b", "start c", "end c"]);
});

test("different keys run in parallel", async () => {
	const queue = createKeyedQueue();
	let running = 0;
	let peak = 0;

	const work = () => async () => {
		running++;
		peak = Math.max(peak, running);
		await tick();
		running--;
		return null;
	};

	await Promise.all([queue.add("w1", work()), queue.add("w2", work())]);
	assert.equal(peak, 2, "the two keys did not wait for each other");
});

test("work that throws rejects its caller and does not block the queue", async () => {
	const queue = createKeyedQueue();

	const failing = queue.add("w", async () => {
		throw new Error("boom");
	});
	await assert.rejects(failing, /boom/);

	assert.equal(await queue.add("w", async () => "next"), "next", "the next work still runs");
});

test("the queue keeps no entry for an idle key", async () => {
	const queue = createKeyedQueue();
	await queue.add("w", async () => null);

	const events: string[] = [];
	await Promise.all([
		queue.add("w", async () => void events.push("first")),
		queue.add("w", async () => void events.push("second")),
	]);
	assert.deepEqual(events, ["first", "second"], "a fresh chain starts from a settled promise");
});

test("a rejection does not poison later waits on the same key", async () => {
	const queue = createKeyedQueue();
	await assert.rejects(
		queue.add("w", async () => {
			throw new Error("first");
		}),
	);
	await assert.rejects(
		queue.add("w", async () => {
			throw new Error("second");
		}),
		/second/,
	);
	assert.equal(await queue.add("w", async () => "ok"), "ok");
});
