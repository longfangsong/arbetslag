import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Context } from "../../context";
import { Tool } from "..";

export const CancelCronJobInputSchema = z
  .object({
    jobId: z.number().int().positive().describe("The cron-job.org job ID to cancel."),
  })
  .describe("Cancel a scheduled cron job by its job ID.");

export class CancelCronJob implements Tool<typeof CancelCronJobInputSchema, { jobId: number }, string> {
  static toolName: string = "cancelCronJob";
  description =
    "Cancel a scheduled cron job using the cron-job.org API. The job will be disabled and will no longer execute. Requires a cron_token in context config.";
  inputSchema = CancelCronJobInputSchema;

  async handler(
    context: Context,
    _agentId: string,
    input: z.infer<typeof CancelCronJobInputSchema>,
  ): Promise<Result<{ jobId: number }, string>> {
    const cronToken = context.config?.cron_token;
    if (!cronToken) {
      return err(
        "Cron token not found in context config. Provide 'cron_token' when creating Context.",
      );
    }

    const response = await fetch(
      `https://api.cron-job.org/jobs/${input.jobId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${cronToken}`,
        },
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return err(
        `Failed to cancel cron job ${input.jobId}: ${response.statusText} — ${errorBody}`,
      );
    }

    return ok({ jobId: input.jobId });
  }
}
