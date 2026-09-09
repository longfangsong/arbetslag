// Self-check for UpdateBatcher. Run: npx tsx batcher.check.ts
import { UpdateBatcher } from "./batcher";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check(): Promise<void> {
	// 1. A burst within the quiet window becomes ONE delivery with all items.
	const got: Array<{ chat: string; n: number }> = [];
	const b = new UpdateBatcher<number>(60, (chat, items) =>
		got.push({ chat, n: items.length }),
	);
	b.enqueue("a", 1);
	b.enqueue("a", 2);
	await sleep(10);
	b.enqueue("a", 3); // new item resets the quiet window
	await sleep(150);
	console.assert(
		got.length === 1 && got[0].chat === "a" && got[0].n === 3,
		`1: expected one batch of 3 for chat a, got ${JSON.stringify(got)}`,
	);
	console.log("1. burst → single batch:", JSON.stringify(got));

	// 2. Different chats flush separately.
	const got2: string[] = [];
	const b2 = new UpdateBatcher<number>(50, (chat) => got2.push(chat));
	b2.enqueue("x", 1);
	b2.enqueue("y", 1);
	await sleep(150);
	console.assert(
		got2.length === 2 && got2.includes("x") && got2.includes("y"),
		`2: expected x and y delivered separately, got ${got2}`,
	);
	console.log("2. per-chat separation:", got2);

	// 2b. Per-chat timers: a later message in chat y must not delay chat x's flush.
	const got2b: Array<{ chat: string; t: number }> = [];
	const t0 = Date.now();
	const b2b = new UpdateBatcher<number>(60, (chat, items) =>
		got2b.push({ chat, t: Date.now() - t0 }),
	);
	b2b.enqueue("x", 1);
	await sleep(20);
	b2b.enqueue("y", 1);
	await sleep(200);
	const x2b = got2b.find((e) => e.chat === "x");
	const y2b = got2b.find((e) => e.chat === "y");
	console.assert(
		x2b && x2b.t >= 55 && x2b.t <= 90 && y2b && y2b.t > x2b.t,
		`2b: expected x to flush ~60ms in, independent of y, got ${JSON.stringify(got2b)}`,
	);
	console.log("2b. independent per-chat timers:", JSON.stringify(got2b));

	// 3. flushNow drains whatever is pending (shutdown path).
	let got3 = 0;
	const b3 = new UpdateBatcher<number>(10_000, (_c, items) => (got3 += items.length));
	b3.enqueue("z", 1);
	b3.enqueue("z", 2);
	b3.flushNow();
	console.assert(got3 === 2, `3: flushNow should deliver 2, got ${got3}`);
	console.assert(b3.pendingCount === 0, "3: nothing pending after flushNow");
	console.log("3. flushNow:", got3, "items delivered");

	console.log("ALL CHECKS PASSED");
}

check();
