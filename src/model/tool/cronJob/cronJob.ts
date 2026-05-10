import { z } from "zod";
import { nanoid } from "nanoid";
import { Context } from "../../context";
import { Tool } from "..";
import type { CronJob } from "./type";
import { err, ok, Result } from "neverthrow";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const CronJobScheduleInputSchema = z.object({
  timezone: z
    .string()
    .describe("The timezone for the job schedule (e.g., 'Europe/Stockholm')."),
  hours: z.array(z.number()).describe("Hours when the job should run (0-23)."),
  mdays: z
    .array(z.number())
    .describe("Days of the month when the job should run (1-31)."),
  minutes: z
    .array(z.number())
    .describe("Minutes when the job should run (0-59)."),
  months: z
    .array(z.number())
    .describe("Months when the job should run (1-12)."),
  wdays: z
    .array(z.number())
    .describe("Days of the week when the job should run (0-6, 0=Sunday)."),
});

// ── Tool ─────────────────────────────────────────────────────────────────────

export class CreateCronJob implements Tool<
  typeof CronJobScheduleInputSchema,
  CronJob
> {
  static readonly toolName: string = "createCronJob";
  description: string =
    "Create a new cron job using the cron-job.org API. Returns an eventId. Call `emitEvent` with this eventId when the cron job callback arrives to notify subscribed agents.";
  inputSchema = CronJobScheduleInputSchema;
  private readonly url: string;

  constructor(metaParams?: Record<string, any>) {
    this.url = metaParams?.url || "";
  }

  async handler(
    context: Context,
    agentId: string,
    input: z.infer<typeof CronJobScheduleInputSchema>,
  ): Promise<Result<CronJob, string>> {
    const cronToken = context.config?.cron_token;
    if (!cronToken) {
      return err(
        "Cron token not found in context. Please provide a cron_token.",
      );
    }

    const eventId = `cron-${nanoid(10)}`;

    const payload = {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronToken}`,
      },
      body: JSON.stringify({
        job: {
          schedule: input,
          url: this.url,
          enabled: true,
          requestMethod: 1,
          extendedData: {
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ eventId }),
          },
        },
      }),
    };
    const response = await fetch("https://api.cron-job.org/jobs", payload);

    if (!response.ok) {
      return err(`Failed to create cron job: ${response.statusText}`);
    }

    const data = (await response.json()) as { jobId: number };

    return ok({
      jobId: data.jobId,
      eventId,
      enabled: true,
      url: this.url,
      schedule: {
        timezone: input.timezone,
        expiresAt: 0,
        hours: input.hours,
        mdays: input.mdays,
        minutes: input.minutes,
        months: input.months,
        wdays: input.wdays,
      },
    });
  }
}
