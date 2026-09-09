import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { parseCronExpression } from "../cron";
import { CronCreate } from "./create";

describe("parseCronExpression", () => {
	it("parses exact values", () => {
		expect(parseCronExpression("0 9 * * 1")).toEqual({
			minutes: [0],
			hours: [9],
			mdays: Array.from({ length: 31 }, (_, i) => i + 1),
			months: Array.from({ length: 12 }, (_, i) => i + 1),
			wdays: [1],
		});
	});

	it("parses wildcards and steps", () => {
		expect(parseCronExpression("*/5 * * * *")).toMatchObject({
			minutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
			hours: Array.from({ length: 24 }, (_, i) => i),
		});
	});

	it("parses ranges, lists and steps on ranges", () => {
		expect(parseCronExpression("30 8-10,12 * * 0-4")).toMatchObject({
			minutes: [30],
			hours: [8, 9, 10, 12],
			wdays: [0, 1, 2, 3, 4],
		});
		expect(
			parseCronExpression("* * * * *")?.minutes,
		).toHaveLength(60);
	});

	it("normalizes day-of-week 7 to 0 (Sunday)", () => {
		expect(parseCronExpression("0 0 * * 7")).toMatchObject({ wdays: [0] });
	});

	it("rejects invalid expressions", () => {
		expect(parseCronExpression("")).toBeNull();
		expect(parseCronExpression("0 9 * *")).toBeNull();
		expect(parseCronExpression("60 9 * * 1")).toBeNull();
		expect(parseCronExpression("0 24 * * 1")).toBeNull();
		expect(parseCronExpression("0 9 0 * 1")).toBeNull();
		expect(parseCronExpression("0 9 * 13 1")).toBeNull();
		expect(parseCronExpression("0 9 * * 8")).toBeNull();
		expect(parseCronExpression("a 9 * * 1")).toBeNull();
		expect(parseCronExpression("5-1 * * * *")).toBeNull();
	});
});

describe("Cron tool callback URL", () => {
	it("embeds chat, text and a verifiable HMAC signature", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(JSON.stringify({ jobId: 1 }), { status: 200 }),
			);
		try {
			const tool = new CronCreate("key", "https://bot.example/cron", "shared-secret");
			const r = await tool.call(
				null as never,
				{ chatId: "123" } as never,
				{ schedule: "0 9 * * 1", title: "周一提醒", text: "提醒用户提交周报" },
			);
			if (r.isErr()) throw new Error(r.error);
			const url = new URL(r.value.url);
			expect(url.searchParams.get("chat")).toBe("123");
			expect(url.searchParams.get("text")).toBe("提醒用户提交周报");
			const expectedSig = createHmac("sha256", "shared-secret")
				.update("123|提醒用户提交周报")
				.digest("hex");
			expect(url.searchParams.get("sig")).toBe(expectedSig);
		} finally {
			fetchMock.mockRestore();
		}
	});
});
