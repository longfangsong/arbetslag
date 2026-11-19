import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { parseCronExpression } from ".";
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
	it("embeds chat, jobId, text and a verifiable HMAC signature", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(
				async () => new Response(JSON.stringify({ jobId: 1 }), { status: 200 }),
			);
		try {
			const tool = new CronCreate("key", "https://bot.example/cron", "shared-secret");
			const r = await tool.call(
				null as never,
				{ chatId: "123" } as never,
				{ schedule: "0 9 * * 1", title: "周一提醒", text: "提醒用户提交周报" },
			);
			if (r.isErr()) throw new Error(r.error);
			expect(r.value.jobId).toBe(1);
			const url = new URL(r.value.url);
			expect(url.searchParams.get("chat")).toBe("123");
			expect(url.searchParams.get("job")).toBe("1");
			expect(url.searchParams.get("text")).toBe("提醒用户提交周报");
			const expectedSig = createHmac("sha256", "shared-secret")
				.update("123|1|提醒用户提交周报")
				.digest("hex");
			expect(url.searchParams.get("sig")).toBe(expectedSig);
			// job created first, then updated so the URL carries the jobId
			expect(fetchMock).toHaveBeenCalledTimes(2);
			const updateCall = fetchMock.mock.calls[1][0];
			expect(String(updateCall)).toBe("https://api.cron-job.org/jobs/1");
		} finally {
			fetchMock.mockRestore();
		}
	});
});

describe("Cron tool time zone", () => {
	const caller = { chatId: "123" } as never;
	const input = { schedule: "0 9 * * 1", title: "周一提醒", text: "提醒用户提交周报" };

	// Runs the tool against a mocked cron-job.org and returns the result with the
	// schedule time zone of the create request, if one was sent.
	async function create(tool: CronCreate, timezone?: string) {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(
				async () => new Response(JSON.stringify({ jobId: 1 }), { status: 200 }),
			);
		try {
			const r = await tool.call(null as never, caller, { ...input, timezone });
			const body = fetchMock.mock.calls[0]?.[1]?.body;
			const sent = body
				? (JSON.parse(String(body)).job.schedule.timezone as string)
				: undefined;
			return { r, sent, calls: fetchMock.mock.calls.length };
		} finally {
			fetchMock.mockRestore();
		}
	}

	it("sends the given time zone and returns it", async () => {
		const tool = new CronCreate("key", "https://bot.example/cron", "s", "UTC");
		const { r, sent } = await create(tool, "Europe/Stockholm");
		expect(sent).toBe("Europe/Stockholm");
		expect(r._unsafeUnwrap().timezone).toBe("Europe/Stockholm");
	});

	it("falls back to the constructor's time zone", async () => {
		const tool = new CronCreate("key", "https://bot.example/cron", "s", "Asia/Shanghai");
		const { r, sent } = await create(tool);
		expect(sent).toBe("Asia/Shanghai");
		expect(r._unsafeUnwrap().timezone).toBe("Asia/Shanghai");
	});

	it("defaults to the runtime's time zone as before", async () => {
		const tool = new CronCreate("key", "https://bot.example/cron", "s");
		const { sent } = await create(tool);
		expect(sent).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
	});

	it("rejects an unknown time zone before calling cron-job.org", async () => {
		const tool = new CronCreate("key", "https://bot.example/cron", "s", "UTC");
		const { r, calls } = await create(tool, "Mars/Olympus_Mons");
		expect(r.isErr()).toBe(true);
		expect(r._unsafeUnwrapErr()).toContain("Mars/Olympus_Mons");
		expect(calls).toBe(0);
	});
});
