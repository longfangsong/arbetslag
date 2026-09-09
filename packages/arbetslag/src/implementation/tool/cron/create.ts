import { z } from "zod";
import { createHmac } from "node:crypto";
import { ok, err, Result } from "neverthrow";
import { ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { CronTool, parseCronExpression } from "../cron";

export const CronCreateInputSchema = z
	.object({
		schedule: z
			.string()
			.describe(
				'Standard 5-field cron expression: "minute hour day-of-month month day-of-week", e.g. "0 9 * * 1" (Mondays 09:00), "*/5 * * * *" (every 5 minutes), "30 8 * * 0-6" (08:30 every day).',
			),
		title: z
			.string()
			.describe(
				"Short job name shown in the cron-job.org console, e.g. '周一早上提醒'.",
			),
		text: z
			.string()
			.describe(
				"Callback payload: what should happen when the job fires. Written as an instruction to yourself, injected into this chat's context when due, e.g. '提醒用户：该提交周报了' or '查一下昨天约定的 API 状态并汇报'.",
			),
	});

export interface CronCreateResult {
	jobId: number;
	url: string;
	schedule: string;
	title: string;
}

export class CronCreate extends CronTool<
	z.infer<typeof CronCreateInputSchema>,
	CronCreateResult
> {
	private readonly callbackUrl: string;
	private readonly secret: string;
	private readonly timezone: string;

	name: string = "create_cron";
	description: string =
		"Create a recurring cron job on cron-job.org. When due, it will GET the configured callback URL, delivering the job's payload to this chat. Returns the jobId (remember it to delete the job later).";
	inputSchema = CronCreateInputSchema;

	constructor(
		apiKey: string,
		callbackUrl: string,
		secret: string,
		timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
	) {
		super(apiKey);
		this.callbackUrl = callbackUrl;
		this.secret = secret;
		this.timezone = timezone;
	}

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof CronCreateInputSchema>,
	): Promise<Result<CronCreateResult, string>> {
		const schedule = parseCronExpression(input.schedule);
		if (schedule === null) {
			return err(
				`Invalid cron expression: "${input.schedule}". Expected 5 fields: minute hour day-of-month month day-of-week.`,
			);
		}

		let url: URL;
		try {
			url = new URL(this.callbackUrl);
		} catch {
			return err(`Invalid callback URL: ${this.callbackUrl}`);
		}

		// The job's context travels in the URL: when cron-job.org fires it,
		// the bot delivers the payload to the chat the job was created in.
		const chatId = _caller?.chatId;
		if (!chatId) {
			return err("Caller agent has no chatId; cannot build callback URL.");
		}
		url.searchParams.set("chat", chatId);
		url.searchParams.set("text", input.text);
		url.searchParams.set(
			"sig",
			createHmac("sha256", this.secret)
				.update(`${chatId}|${input.text}`)
				.digest("hex"),
		);

		try {
			const data = (await this.request("/jobs", {
				method: "PUT",
				body: JSON.stringify({
					job: {
						url: url.toString(),
						title: input.title,
						enabled: true,
						requestMethod: 0,
						schedule: {
							...schedule,
							timezone: this.timezone,
							expiresAt: 0,
						},
					},
				}),
			})) as { jobId?: number };
			if (data.jobId === undefined) {
				return err("cron-job.org did not return a jobId.");
			}
			return ok({
				jobId: data.jobId,
				url: url.toString(),
				schedule: input.schedule,
				title: input.title,
			});
		} catch (e) {
			return err(e instanceof Error ? e.message : String(e));
		}
	}
}
