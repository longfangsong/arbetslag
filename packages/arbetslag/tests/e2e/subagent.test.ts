import { expect, it } from "vitest";
import type { Template } from "@/application/agent/template/model";
import { entryText } from "./support/entry";
import { ListTemplates } from "@/implementation/tool/subagent/listTemplates";
import { SpawnAgent } from "@/implementation/tool/subagent/spawn";
import { createHarness, messageEvent } from "./support/harness";

const entryTemplate: Template = {
	name: "default",
	description: "entry agent",
	ai_provider: "fake",
	model: "test-model",
	systemPrompt: "You are the entry agent.",
	allowedTools: ["list_templates", "spawn_agent"],
};

const subTemplate: Template = {
	name: "researcher",
	description: "does research",
	ai_provider: "fake",
	model: "test-model",
	systemPrompt: "You are a researcher.",
	allowedTools: [],
};

it("e2e: spawn_agent creates a Sub-agent, hands it the task, and its isolated history reaches the LLM", async () => {
	const h = await createHarness({
		rules: new Map([
			[
				/^派个子 agent/,
				[
					{ tool_calls: [{ tool_name: "spawn_agent", arguments: { template: "researcher", task: "查一下 X" } }] },
					{ content: "已经派人去查了。" },
				],
			],
			[/^<agent_message>/, { content: "查到了：X = 42。" }],
		]),
		templates: [entryTemplate, subTemplate],
		tools: [new ListTemplates(), new SpawnAgent()],
	});

	try {
		const result = await h.run(messageEvent("派个子 agent 查一下 X"));
		expect(result.isOk(), result.isErr() ? result.error : "ok").toBe(true);

		// two agents exist now: the entry agent plus the created Sub-agent
		const agents = await h.agentRepository.list();
		expect(agents).toHaveLength(2);
		const entry = agents.find((a) => a.chatId === "chat-1")!;
		const sub = agents.find((a) => a.id !== entry.id)!;
		expect(sub.template.name).toBe("researcher");

		// isolated context: the Sub-agent saw only the task as an <agent_message>,
		// never the entry agent's history
		expect(sub.history.map((e) => e.role)).toEqual(["system", "user", "assistant"]);
		expect(entryText(sub.history[1])).toContain(`<from_agent_id>${entry.id}</from_agent_id>`);
		expect(entryText(sub.history[1])).toContain("<content>查一下 X</content>");

		// call order: entry (tool list) → Sub-agent (its own allowed tools) → entry (tool result)
		expect(h.llm.requests.map((r) => r.tools)).toEqual([
			["list_templates", "spawn_agent"],
			[],
			["list_templates", "spawn_agent"],
		]);

		// both replies reach the chat: Sub-agent's report, then the entry agent's ack
		const sent = h.api.callsMatching(/sendRichMessage$/);
		expect(sent.map((c) => c.body)).toEqual([
			{ chat_id: "chat-1", rich_message: { markdown: "查到了：X = 42。" } },
			{ chat_id: "chat-1", rich_message: { markdown: "已经派人去查了。" } },
		]);
	} finally {
		await h.close();
	}
});
