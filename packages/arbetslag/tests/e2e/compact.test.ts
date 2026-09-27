import { expect, it } from "vitest";
import { entryText } from "./support/entry";
import type { Template } from "@/application/agent/template/model";
import { SUMMARY_MARKER } from "@/application/agent/compact";
import { ReadFile } from "@/implementation/tool/file/readFile";
import { createHarness, messageEvent } from "./support/harness";

const FILE = "notes.txt";
// bulky tool result: rule-level compaction stubs it, which is what we assert below
const BULKY_FILE_CONTENT = "x".repeat(500);

const template: Template = {
	name: "default",
	description: "test template",
	ai_provider: "fake",
	model: "test-model",
	systemPrompt: "You are a test agent.",
	allowedTools: ["read_file"],
	compactThreshold: 300,
	compactRetainRounds: 1,
};

const ROUND_1 = "r1 " + "a".repeat(597); // ~150 tokens, below the threshold at round 1
const ROUND_2 = "r2 " + "b".repeat(117); // pushes the metered size over the threshold

it("e2e: compaction stubs bulky tool output, then rolls the aged rounds into one summary", async () => {
	const h = await createHarness({
		rules: new Map([
			// LLM-level compaction calls complete() with no tools — put its rule first
			[
				/^# New conversation history is to be summarized/,
				{ content: "Alice asked for notes.txt to be read; it contained a bulky payload." },
			],
			[
				/^r1/,
				[
					{ tool_calls: [{ tool_name: "read_file", arguments: { path: FILE } }] },
					{ content: "read round 1" },
				],
			],
			[/^r2/, { content: "summarized round 1" }],
		]),
		templates: [template],
		tools: [new ReadFile()],
	});

	try {
		await h.fileSystem.writeFile(FILE, BULKY_FILE_CONTENT);
		await h.run(messageEvent(ROUND_1, "alice"));
		await h.run(messageEvent(ROUND_2, "alice"));

		// 4 calls: round 1, its answer, the LLM-level summary, round 2's answer.
		// Rule-level compaction alone never calls the provider.
		expect(h.llm.requests).toHaveLength(4);

		const summary = h.llm.requests.filter((r) =>
			/^# New conversation history is to be summarized/.test(r.matchText),
		);
		expect(summary).toHaveLength(1);
		expect(summary[0].tools).toEqual([]); // compaction asks for a plain completion
		// the summary input already carries the rule-level stubs
		expect(summary[0].matchText).toContain("[tool read_file] [omitted]");

		// after compaction: one system entry (meta prompt + summary) plus the retained round
		const history = h.llm.requests[3].history;
		expect(history.map((e) => e.role)).toEqual(["system", "user"]);
		const system = entryText(history[0]);
		expect(system).toContain("框架元消息"); // meta prompt survives compaction
		expect(system).toContain(SUMMARY_MARKER);
		expect(system).toContain("Alice asked for notes.txt to be read");
		expect(system).not.toContain(ROUND_1); // aged round is gone, only the summary remains
		expect(entryText(history[1])).toBe(ROUND_2);

		// compact notices were routed by the orchestrator
		const notices = h.api
			.callsMatching(/sendRichMessage$/)
			.map((c) => (c.body as { rich_message: { markdown: string } }).rich_message.markdown);
		expect(notices.filter((m) => m.includes("Compacted history")).length).toBeGreaterThanOrEqual(1);
		expect(notices.at(-1)).toBe("summarized round 1");
	} finally {
		await h.close();
	}
});
