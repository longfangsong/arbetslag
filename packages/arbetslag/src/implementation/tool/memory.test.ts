import { describe, it, expect } from "vitest";
import { InMemoryFileSystem } from "./file/filesystem/inMemory";
import { SimpleMemoryRead, SimpleMemoryUpdate, MEMORY_FILE } from "./memory";

function makeTools() {
	const fileSystem = new InMemoryFileSystem();
	const ctx = { fileSystem };
	return {
		fileSystem,
		ctx,
		read: new SimpleMemoryRead(),
		update: new SimpleMemoryUpdate(),
	};
}

describe("SimpleMemory", () => {
	it("read on empty fs reports no memory", async () => {
		const { ctx, read } = makeTools();
		const result = await read.call(ctx, null as never, {});
		expect(result.isOk()).toBe(true);
		expect(result.isOk() && result.value).toMatch(/does not exist/);
	});

	it("update appends a fact and read returns it", async () => {
		const { ctx, read, update, fileSystem } = makeTools();
		const upd = await update.call(ctx, null as never, {
			content: "- alice likes architecture debates",
		});
		expect(upd.isOk() && upd.value).toBe("Saved to MEMORY.md.");

		const reread = await read.call(ctx, null as never, {});
		expect(reread.isOk() && reread.value).toContain(
			"alice likes architecture",
		);
		expect(await fileSystem.readFile(MEMORY_FILE)).toContain(
			"alice likes architecture",
		);
	});

	it("update with blank content errors", async () => {
		const { ctx, update } = makeTools();
		const result = await update.call(ctx, null as never, { content: "   " });
		expect(result.isOk()).toBe(false);
	});
});
