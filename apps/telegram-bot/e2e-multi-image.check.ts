// E2E smoke check for the multi-image workaround. Run: npx tsx e2e-multi-image.check.ts
//
// Drives the REAL Orchestrator/Agent with a fake AI provider and mirrors the
// processChatBatch branch (≤1 image → merged event, ≥2 images → one event per
// input via splitAtMostOneImage). Asserts the endpoint invariant: no user
// entry ever carries more than one image part — and counts the LLM calls so
// the N-call cost of splitting is visible.

import { ok } from "neverthrow";
import {
	Orchestrator,
	InMemoryFileSystem,
	FileSystemAgentRepository,
	FileSystemTemplateRepository,
	InMemoryToolRepository,
	InMemoryAIProviderRepository,
	type Template,
	type MessageEvent,
	type Content,
} from "arbetslag";
import { splitAtMostOneImage } from "./split-images";

const t = (s: string) => ({ type: "text" as const, text: s });
const img = (url: string) => ({ type: "image" as const, url });

let failures = 0;
function assert(cond: boolean, msg: string): void {
	console.assert(cond, msg);
	if (!cond) {
		failures++;
		console.error(`✗ ${msg}`);
	} else {
		console.log(`✓ ${msg}`);
	}
}

/** Mirrors the processChatBatch branch in telegram-bot.ts. */
function buildEvents(inputs: Array<MessageEvent>): Array<MessageEvent> {
	const totalImages = inputs.reduce(
		(n, i) => n + i.content.filter((p) => p.type === "image").length,
		0,
	);
	if (totalImages <= 1) {
		return [{ ...inputs[0]!, content: inputs.flatMap((i) => i.content) }];
	}
	return inputs.flatMap((i, n) =>
		splitAtMostOneImage(i.content).map((content, m) => ({
			...i,
			id: `${i.id}-${m}`,
			content,
		})),
	);
}

let eventN = 0;
function msg(chatId: string, content: Content): MessageEvent {
	return {
		id: `m${++eventN}`,
		event_type: "message",
		chat_id: chatId,
		adapter: "telegram",
		content,
		send_time: Date.now(),
		sender: "tester",
	};
}

async function runScenario(
	name: string,
	inputs: Array<MessageEvent>,
	singleImage = false,
): Promise<{ llmCalls: number; callImages: Array<number>; userEntries: Array<Array<{ type: string; text?: string }>>; totalImages: number }> {
	const fileSystem = new InMemoryFileSystem();
	const templateRepository = await FileSystemTemplateRepository.create(fileSystem);
	await templateRepository.add({
		name: "default",
		description: "test",
		ai_provider: "fake",
		model: "fake-model",
		systemPrompt: "you are a test bot",
		allowedTools: [],
		...(singleImage ? { singleImage: true } : {}),
	} satisfies Template);

	let llmCalls = 0;
	const callImages: Array<number> = [];
	const provider = {
		name: "fake",
		async complete(
			_model: string,
			history: Array<{ role: string; content?: unknown }>,
		) {
			llmCalls++;
			// Images the endpoint would receive in THIS request: across the
			// whole replayed history, not just the newest message.
			callImages.push(
				history.reduce((n, h) => {
					if (h.role !== "user" || !Array.isArray(h.content)) return n;
					return (
						n +
						(h.content as Array<{ type: string }>).filter(
							(p) => p.type === "image",
						).length
					);
				}, 0),
			);
			return ok({
				role: "assistant",
				content: `reply-${llmCalls}`,
				tool_calls: [],
			});
		},
	};

	const agentRepository = await FileSystemAgentRepository.create(fileSystem);
	const orchestrator = new Orchestrator({
		fileSystem,
		agentRepository,
		templateRepository,
		toolRepository: new InMemoryToolRepository([]),
		aiProviderRepository: new InMemoryAIProviderRepository([
			provider as never,
		]),
		outputRouter: null,
	});

	const events = buildEvents(inputs);
	for (const e of events) orchestrator.push(e);
	const result = await orchestrator.stepUntilIdle();
	assert(result.isOk(), `${name}: stepUntilIdle ok`);

	const agent = await agentRepository.getByChatId("chat1");
	assert(agent !== null, `${name}: agent exists`);
	const userEntries = agent!
		.history.filter((h) => h.role === "user")
		.map((h) =>
			(h.content as Array<{ type: string; text?: string }>).map((p) => ({
				type: p.type,
				...("text" in p ? { text: (p as { text: string }).text } : {}),
			})),
		);
	const totalImages = userEntries.reduce(
		(n, e) => n + e.filter((p) => p.type === "image").length,
		0,
	);
	for (const [i, entry] of userEntries.entries()) {
		const images = entry.filter((p) => p.type === "image").length;
		assert(images <= 1, `${name}: user entry ${i} has ≤1 image (has ${images})`);
	}
	return { llmCalls, callImages, userEntries, totalImages };
}

async function main(): Promise<void> {
	// A. Album of 3 photos + a text message (the case that used to break).
	{
		const inputs = [
			msg("chat1", [t("[tester]: cap1"), img("data:image/jpeg;base64,A")]),
			msg("chat1", [t("[tester]: cap2"), img("data:image/jpeg;base64,B")]),
			msg("chat1", [t("[tester]: cap3"), img("data:image/jpeg;base64,C")]),
			msg("chat1", [t("[tester]: now describe them")]),
		];
		const r = await runScenario("album of 3", inputs);
		assert(r.totalImages === 3, `album: all 3 images present (got ${r.totalImages})`);
		assert(r.userEntries.length === 4, `album: 4 user entries (got ${r.userEntries.length})`);
		assert(r.llmCalls === 4, `album: 4 LLM calls, one per split message (got ${r.llmCalls})`);
		const texts = r.userEntries.map((e) => e.filter((p) => p.type === "text").map((p) => p.text).join("|")).join(" / ");
		assert(texts.includes("cap1") && texts.includes("cap3") && texts.includes("now describe them"), `album: order preserved (${texts})`);
	}

	// B. Single photo + text burst → stays merged (unchanged behavior: 1 call).
	{
		const inputs = [
			msg("chat1", [t("[tester]: look"), img("data:image/jpeg;base64,A")]),
			msg("chat1", [t("[tester]: and this")]),
		];
		const r = await runScenario("single photo", inputs);
		assert(r.totalImages === 1, `single photo: 1 image present (got ${r.totalImages})`);
		assert(r.userEntries.length === 1, `single photo: merged into 1 user entry (got ${r.userEntries.length})`);
		assert(r.llmCalls === 1, `single photo: 1 LLM call (got ${r.llmCalls})`);
	}

	// C. Photo quoting a photo (2 images in ONE input) + another photo.
	{
		const inputs = [
			msg("chat1", [
				t("[tester]: <reply_to>[photo]</reply_to>"),
				img("data:image/jpeg;base64,QUOTED"),
				t("[tester]: my caption"),
				img("data:image/jpeg;base64,NEW"),
			]),
			msg("chat1", [img("data:image/jpeg;base64,THIRD")]),
		];
		const r = await runScenario("photo quoting a photo", inputs);
		assert(r.totalImages === 3, `photo-quoting-photo: all 3 images present (got ${r.totalImages})`);
		assert(r.userEntries.length === 3, `photo-quoting-photo: 3 user entries (got ${r.userEntries.length})`);
		assert(r.llmCalls === 3, `photo-quoting-photo: 3 LLM calls (got ${r.llmCalls})`);
	}

	// D. Album of 3 photos with the template's singleImage flag: every request
	//    sent to the endpoint must hold ≤1 image in the WHOLE history.
	{
		const inputs = [
			msg("chat1", [t("[tester]: cap1"), img("data:image/jpeg;base64,A")]),
			msg("chat1", [t("[tester]: cap2"), img("data:image/jpeg;base64,B")]),
			msg("chat1", [t("[tester]: cap3"), img("data:image/jpeg;base64,C")]),
		];
		const r = await runScenario("singleImage album", inputs, true);
		assert(
			r.callImages.every((n) => n <= 1),
			`singleImage: every request carries ≤1 image (got ${JSON.stringify(r.callImages)})`,
		);
		assert(
			r.callImages[2] === 1,
			`singleImage: the newest image is still sent in the last request (got ${r.callImages[2]})`,
		);
		assert(r.totalImages === 1, `singleImage: exactly 1 image left in history (got ${r.totalImages})`);
		const markers = r.userEntries.flat().filter((p) => p.type === "text" && p.text === "[Image]").length;
		assert(markers === 2, `singleImage: 2 earlier images demoted to [Image] (got ${markers})`);
	}

	if (failures > 0) {
		console.error(`${failures} check(s) FAILED`);
		process.exit(1);
	}
	console.log("ALL CHECKS PASSED");
}

main();
