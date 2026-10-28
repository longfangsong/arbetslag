import assert from "node:assert/strict";
import { test } from "node:test";
import type { JsonValue } from "type-fest";
import type { History, ModelCompleteInput, ToolSpec } from "@arbetslag/agents";
import { modelCompleteInputSchema, textMessage } from "@arbetslag/agents";
import { modelPerformer } from "../src/index.ts";
import { fromAssistant, toChatMessages, toToolDefinitions } from "../src/openai/translate.ts";

const tools: ToolSpec[] = [
	{
		name: "plus_one",
		description: "加一",
		input: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
	},
];

const call = (callId: string, name: string, input: JsonValue) => ({
	type: "tool-call" as const,
	callId,
	name,
	input,
});

test("system and user messages go as plain text", () => {
	const history: History = [textMessage("system", "你是个助手"), textMessage("user", "你好")];
	assert.deepEqual(toChatMessages(history), [
		{ role: "system", content: "你是个助手" },
		{ role: "user", content: "你好" },
	]);
});

test("an assistant turn with a call becomes one message with stringified arguments", () => {
	const history: History = [
		textMessage("user", "41 加一"),
		{ role: "assistant", blocks: [call("c1", "plus_one", { n: 41 })] },
	];
	assert.deepEqual(toChatMessages(history), [
		{ role: "user", content: "41 加一" },
		{
			role: "assistant",
			content: null,
			tool_calls: [
				{ id: "c1", type: "function", function: { name: "plus_one", arguments: '{"n":41}' } },
			],
		},
	]);
});

test("one history message with several tool results becomes several tool messages", () => {
	const history: History = [
		{
			role: "tool",
			blocks: [
				{ type: "tool-result", callId: "c1", name: "plus_one", ok: true, result: { n: 42 } },
				{ type: "tool-result", callId: "c2", name: "plus_one", ok: false, result: { error: "boom" } },
			],
		},
	];
	assert.deepEqual(toChatMessages(history), [
		{ role: "tool", tool_call_id: "c1", content: '{"n":42}' },
		{ role: "tool", tool_call_id: "c2", content: 'error: {"error":"boom"}' },
	]);
});

test("text and a call in the same turn keep both", () => {
	const history: History = [
		{ role: "assistant", blocks: [{ type: "text", text: "我先查一下" }, call("c1", "plus_one", { n: 1 })] },
	];
	const [message] = toChatMessages(history);
	assert.equal((message as { content: string }).content, "我先查一下");
	assert.equal((message as { tool_calls: unknown[] }).tool_calls.length, 1);
});

test("tool specs are what the model sees, unchanged", () => {
	assert.deepEqual(toToolDefinitions(tools), [
		{
			type: "function",
			function: {
				name: "plus_one",
				description: "加一",
				parameters: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
			},
		},
	]);
});

test("an answer becomes an assistant message", () => {
	assert.deepEqual(fromAssistant("是 42"), {
		ok: true,
		message: { role: "assistant", blocks: [{ type: "text", text: "是 42" }] },
	});
});

test("tool calls are parsed into blocks with their ids", () => {
	assert.deepEqual(
		fromAssistant(null, [
			{ id: "c1", type: "function", function: { name: "plus_one", arguments: '{"n":1}' } },
			{ id: "c2", type: "function", function: { name: "plus_one", arguments: "" } },
			{ id: "c3", type: "function", function: { name: "plus_one", arguments: "{oops" } },
		]),
		{
			ok: true,
			message: {
				role: "assistant",
				blocks: [
					call("c1", "plus_one", { n: 1 }),
					call("c2", "plus_one", {}),
					call("c3", "plus_one", "{oops"),
				],
			},
		},
	);
});

test("an empty answer is a failure, not a silent success", () => {
	const result = fromAssistant(null, []);
	assert.deepEqual(result, { ok: false, error: "model returned nothing" });
});

test("the performer hands the parsed input to the vendor call", async () => {
	const input: ModelCompleteInput = {
		model: "fake-1",
		messages: [textMessage("user", "你好")],
		tools: [],
	};
	const perform = modelPerformer(async ({ input, workflowId }) => {
		assert.equal(workflowId, "w1");
		assert.equal(input.model, "fake-1");
		return { ok: true, message: textMessage("assistant", "在的") };
	});

	const result = await perform(modelCompleteInputSchema.parse(input) as JsonValue, { workflowId: "w1" });
	assert.deepEqual(result, { ok: true, message: { role: "assistant", blocks: [{ type: "text", text: "在的" }] } });
});

test("a thrown error and a malformed input both come back as ok: false", async () => {
	const boom = modelPerformer(async () => {
		throw new Error("rate limited");
	});
	assert.deepEqual(await boom(modelCompleteInputSchema.parse({ model: "m", messages: [] }) as JsonValue, { workflowId: "w" }), {
		ok: false,
		error: "rate limited",
	});

	const whatever = modelPerformer(async () => ({ ok: true, message: textMessage("assistant", "不该走到这") }));
	const bad = (await whatever({ nope: true }, { workflowId: "w" })) as { ok: boolean; error: string };
	assert.equal(bad.ok, false);
	assert.match(bad.error, /bad model\.complete input/);
});
