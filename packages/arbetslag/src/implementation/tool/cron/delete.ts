import { z } from "zod";
import { ok, err, Result } from "neverthrow";
import { ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";
import { CronTool } from "../cron";

export const CronDeleteInputSchema = z
	.object({
		job_id: z
			.number()
			.int()
			.positive()
			.describe("The cron job ID returned when the job was created."),
	});

export interface CronDeleteResult {
	jobId: number;
}

export class CronDelete extends CronTool<
	z.infer<typeof CronDeleteInputSchema>,
	CronDeleteResult
> {
	name: string = "delete_cron";
	description: string =
		"Delete a recurring cron job on cron-job.org by its job ID (the jobId returned by cron_create).";
	inputSchema = CronDeleteInputSchema;

	async call(
		_context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof CronDeleteInputSchema>,
	): Promise<Result<CronDeleteResult, string>> {
		try {
			await this.request(`/jobs/${input.job_id}`, { method: "DELETE" });
			return ok({ jobId: input.job_id });
		} catch (e) {
			return err(e instanceof Error ? e.message : String(e));
		}
	}
}
