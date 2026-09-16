import { describe, expect, it } from "vitest";
import { OpenAIProvider, contentToStringOrParts } from "./openai";

const image = { type: "image" as const, url: "https://example.com/a.png" };
const text = { type: "text" as const, text: "hi" };

describe("contentToStringOrParts", () => {
	it("passes string content through", () => {
		expect(contentToStringOrParts("hello")).toBe("hello");
	});

	it("keeps text and image parts when images are supported", () => {
		const out = contentToStringOrParts([text, image]);
		expect(Array.isArray(out)).toBe(true);
		expect(out).toHaveLength(2);
		expect(out[1]).toEqual({ type: "image_url", image_url: { url: image.url } });
	});

	it("strips image parts when images are not supported", () => {
		expect(contentToStringOrParts([text, image], false)).toEqual([
			{ type: "text", text: "hi" },
		]);
	});

	it("returns empty string when only images remain", () => {
		expect(contentToStringOrParts([image], false)).toBe("");
	});
});

async function completeAgainstRejectingBackend(errorMessage: string) {
	const provider = new OpenAIProvider("key");
	const calls: Array<{ content: unknown }> = [];
	(provider as unknown as { client: unknown }).client = {
		chat: {
			completions: {
				create: async (body: { messages: Array<{ content: unknown }> }) => {
					calls.push(...body.messages);
					const hasImage = body.messages.some((m) =>
						Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
					);
					if (hasImage) throw new Error(errorMessage);
					return { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1 } };
				},
			},
		},
	};
	const res = await provider.complete("model", [{ role: "user", content: [text, image] }], []);
	return { res, calls };
}

describe("image-unsupported backend auto-detection", () => {
	it.each([
		"400 At most 0 image(s) may be provided in one prompt. (parameter=image)",
		"500 image input is not supported - hint: if this is unexpected, you may need to provide the mmproj",
	])("retries without images after: %s", async (errorMessage) => {
		const { res, calls } = await completeAgainstRejectingBackend(errorMessage);
		expect(res.isOk()).toBe(true);
		expect(calls).toHaveLength(2);
		expect(calls[1]).toEqual({ role: "user", content: [{ type: "text", text: "hi" }] });
	});
});
