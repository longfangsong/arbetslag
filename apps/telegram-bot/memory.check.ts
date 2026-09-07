// Ponytail self-check for MemoryTool. Run: npx tsx memory.check.ts
import { InMemoryFileSystem } from "arbetslag";
import { MemoryTool, MEMORY_FILE } from "./memory";

async function check(): Promise<void> {
	const fs = new InMemoryFileSystem();
	const tool = new MemoryTool();
	const ctx = { fileSystem: fs };

	const read = await tool.call(ctx, null, { action: "read" });
	console.assert(read.isOk(), "read on empty should be ok");
	console.assert(
		read.isOk() && /does not exist/.test(read.value),
		"read on empty should say not-exist",
	);
	console.log("1. read (empty):", read.isOk() ? read.value : read.error);

	const upd = await tool.call(ctx, null, {
		action: "update",
		content: "- alice likes architecture debates",
	});
	console.assert(
		upd.isOk() && upd.value === "Saved to MEMORY.md.",
		"update should report saved",
	);
	console.log("2. update:", upd.isOk() ? upd.value : upd.error);

	const reread = await tool.call(ctx, null, { action: "read" });
	console.assert(
		reread.isOk() && reread.value.includes("alice likes architecture"),
		"read should return the stored fact",
	);
	console.log("3. read (after update):", reread.isOk() ? reread.value : reread.error);

	const empty = await tool.call(ctx, null, { action: "update", content: "   " });
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
