import { expect, it } from "vitest";
import { entryText } from "./support/entry";
import type { Template } from "@/application/agent/template/model";
import { createHarness, messageEvent } from "./support/harness";

const template: Template = {
	name: "default",
	description: "test template",
	ai_provider: "fake",
	model: "test-model",
	systemPrompt: "You are a test agent.",
	allowedTools: [],
};

it("e2e: a plain message runs through the orchestrator and is replied to the chat", async () => {
	const h = await createHarness({
		rules: new Map([[/^我叫/, { content: "收到，Alice。" }]]),
		templates: [template],
		tools: [],
	});

	try {
		const result = await h.run(messageEvent("我叫 Alice"));
		expect(result.isOk(), result.isErr() ? result.error : "ok").toBe(true);

		// what the LLM saw: composed system entry (template prompt + meta prompt), then the message
		expect(h.llm.requests).toHaveLength(1);
		const seen = h.llm.requests[0];
		expect(seen.model).toBe("test-model");
		expect(seen.history.map((e) => e.role)).toEqual(["system", "user"]);
		const system = entryText(seen.history[0]);
		expect(system).toContain("You are a test agent.");
		expect(system).toContain("框架元消息");
		expect(entryText(seen.history[1])).toBe("我叫 Alice");

		// what the world received
		const sent = h.api.callsMatching(/sendRichMessage$/);
		expect(sent).toHaveLength(1);
		expect(sent[0].body).toEqual({
			chat_id: "chat-1",
			rich_message: { markdown: "收到，Alice。" },
		});

		// checkpointed state on disk
		const files = await h.fileSystem.listFiles("agents/");
		expect(files).toHaveLength(2);
		const chatMap = JSON.parse(await h.fileSystem.readFile(files.find((f) => f.endsWith("chat_map.json"))!));
		expect(chatMap).toEqual({ "chat-1": expect.any(String) });
		const persisted = JSON.parse(await h.fileSystem.readFile(files.find((f) => !f.endsWith("chat_map.json"))!));
		expect(persisted.history.map((e: { role: string }) => e.role)).toEqual([
			"system",
			"user",
			"assistant",
		]);
	} finally {
		await h.close();
	}
});
