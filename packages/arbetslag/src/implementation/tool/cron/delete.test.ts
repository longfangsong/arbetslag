import { describe, it, expect, vi } from "vitest";
import { CronDelete } from "./delete";

describe("CronDelete tool", () => {
	it("DELETEs the job and returns its id", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("{}", { status: 200 }));
		try {
			const tool = new CronDelete("key");
			const r = await tool.call(null as never, null as never, {
				job_id: 8417625,
			});
			if (r.isErr()) throw new Error(r.error);
			expect(r.value).toEqual({ jobId: 8417625 });
			const [url, init] = fetchMock.mock.calls[0];
			expect(init).toBeDefined();
			expect(url).toBe("https://api.cron-job.org/jobs/8417625");
			expect(init!.method).toBe("DELETE");
			expect(
				(init!.headers as Record<string, string>).Authorization,
			).toBe("Bearer key");
		} finally {
			fetchMock.mockRestore();
		}
	});

	it("surfaces API errors as tool errors", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(JSON.stringify({ error: "Job not found." }), {
					status: 404,
				}),
			);
		try {
			const tool = new CronDelete("key");
			const r = await tool.call(null as never, null as never, {
				job_id: 1,
			});
			expect(r.isErr()).toBe(true);
			if (r.isErr()) expect(r.error).toContain("Job not found.");
		} finally {
			fetchMock.mockRestore();
		}
	});
});
