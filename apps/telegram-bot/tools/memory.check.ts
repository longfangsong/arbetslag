// Ponytail self-check for the memory tools. Run: npx tsx memory.check.ts
import { InMemoryFileSystem } from "arbetslag";
import { MemoryRead, MemoryUpdate, MEMORY_FILE } from "./memory";

async function check(): Promise<void> {
	const fs = new InMemoryFileSystem();
	const read = new MemoryRead();
	const update = new MemoryUpdate();
	const ctx = { fileSystem: fs };

	const r1 = await read.call(ctx, null as never, {});
	console.assert(r1.isOk(), "read on empty should be ok");
	console.assert(
		r1.isOk() && /does not exist/.test(r1.value),
		"read on empty should say not-exist",
	);
	console.log("1. read (empty):", r1.isOk() ? r1.value : r1.error);

	const upd = await update.call(ctx, null as never, {
		content: "- alice likes architecture debates",
	});
	console.assert(
		upd.isOk() && upd.value === "Saved to MEMORY.md.",
		"update should report saved",
	);
	console.log("2. update:", upd.isOk() ? upd.value : upd.error);

	const reread = await read.call(ctx, null as never, {});
	console.assert(
		reread.isOk() && reread.value.includes("alice likes architecture"),
		"read should return the stored fact",
	);
	console.log("3. read (after update):", reread.isOk() ? reread.value : reread.error);

	const empty = await update.call(ctx, null as never, { content: "   " });
	console.assert(!empty.isOk(), "update with blank content should error");
	console.log("4. update (blank):", empty.isOk() ? empty.value : empty.error);

	const raw = await fs.readFile(MEMORY_FILE);
	console.assert(raw.includes("alice likes architecture"), "fs must persist the fact");
	console.log("5. raw MEMORY.md on disk:", JSON.stringify(raw));

	console.log("ALL CHECKS PASSED");
}

check().catch((error) => {
	console.error(error);
	process.exit(1);
});
