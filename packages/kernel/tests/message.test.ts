import assert from "node:assert/strict";
import { test } from "node:test";
import {
	EFFECT_END,
	isReservedType,
	messageSchema,
} from "../src/message.ts";

test("message accepts the three-field envelope", () => {
	assert.ok(messageSchema.safeParse({ from: "n1", type: "reply", body: { a: 1 } }).success);
});

test("message from is optional (external delivery, effect receipt)", () => {
	assert.ok(messageSchema.safeParse({ type: "text", body: "hi" }).success);
});

test("message rejects empty type and non-JSON body", () => {
	assert.ok(!messageSchema.safeParse({ type: "", body: null }).success);
	assert.ok(!messageSchema.safeParse({ type: "x", body: () => 1 }).success);
	assert.ok(!messageSchema.safeParse({ type: "x", body: undefined }).success);
});

test("message strips unknown fields: no destination, no kernel id", () => {
	const parsed = messageSchema.parse({ type: "x", body: null, to: "n2", id: "k" });
	assert.deepEqual(Object.keys(parsed).sort(), ["body", "type"]);
});

test("@ prefix is reserved", () => {
	assert.ok(isReservedType(EFFECT_END));
	assert.ok(!isReservedType("reply"));
});
