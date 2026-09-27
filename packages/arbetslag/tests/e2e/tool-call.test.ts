import { expect, it } from "vitest";
import { entryText } from "./support/entry";
import type { Template } from "@/application/agent/template/model";
import { ReadFile } from "@/implementation/tool/file/readFile";
import { createHarness, messageEvent } from "./support/harness";

const FILE = "notes.txt";
const FILE_CONTENT = "alpha beta gamma";

const template: Template = {
	name: "default",
	description: "test template",
	ai_provider: "fake",
	model: "test-model",
	systemPrompt: "You are a test agent.",
	allowedTools: ["read_file"],
};

it("e2e: the agent calls a tool, the tool really runs against the file system, and the result comes back to the LLM", async () => {
	const h = await createHarness({
		// same rule serves both calls of the round: first the tool call, then the answer
		rules: new Map([
			[
				/^读一下/,
				[
					{ tool_calls: [{ tool_name: "read_file", arguments: { path: FILE } }] },
					{ content: "文件里是 alpha beta gamma。" },
				],
			],
		]),
		templates: [template],
		tools: [new ReadFile()],
	});

	try {
		await h.fileSystem.writeFile(FILE, FILE_CONTENT);
		const result = await h.run(messageEvent("读一下 notes.txt"));
		expect(result.isOk(), result.isErr() ? result.error : "ok").toBe(true);

		// the tool ran for real: the file the tool read is still on disk
		expect(await h.fileSystem.readFile(FILE)).toBe(FILE_CONTENT);

		// call 1 saw the tool list, call 2 saw the tool result as a tool entry
		expect(h.llm.requests.map((r) => r.tools)).toEqual([["read_file"], ["read_file"]]);
		expect(h.llm.requests[1].history.map((e) => e.role)).toEqual([
			"system",
			"user",
			"assistant",
			"tool",
		]);

		const assistant = h.llm.requests[1].history[2];
		expect(assistant.role).toBe("assistant");
		expect(assistant.role === "assistant" ? assistant.tool_calls : undefined).toEqual([
			{ id: "call1", tool_name: "read_file", arguments: { path: FILE } },
		]);

		const toolEntry = h.llm.requests[1].history[3];
		expect(toolEntry.role).toBe("tool");
		expect(toolEntry.role === "tool" ? toolEntry.name : undefined).toBe("read_file");
		expect(toolEntry.role === "tool" ? toolEntry.content : undefined).toBe(
			JSON.stringify(FILE_CONTENT),
		);

		// one reply reaches the chat — the tool result itself is not sent
		const sent = h.api.callsMatching(/sendRichMessage$/);
		expect(sent).toHaveLength(1);
		expect(sent[0].body).toEqual({
			chat_id: "chat-1",
			rich_message: { markdown: "文件里是 alpha beta gamma。" },
		});

		expect(entryText(h.llm.requests[1].history[1])).toBe("读一下 notes.txt");
	} finally {
		await h.close();
	}
});
