import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryIndex } from "../src/workflowIndex.ts";

test("the memory index reads the array it was given, every time", async () => {
	const ids = ["a"];
	const index = createMemoryIndex(ids);
	assert.deepEqual(await index.ids(), ["a"]);
	ids.push("b");
	assert.deepEqual(await index.ids(), ["a", "b"]);
});
