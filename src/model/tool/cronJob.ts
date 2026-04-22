import { z } from "zod";
import { Context } from "../context";
import { Session } from "../session";
import { Tool } from ".";

export const CronJobScheduleInputSchema = z.object({
  timezone: z
    .string()
    .describe("The timezone for the job schedule (e.g., 'Europe/Stockholm')."),
  // expiresAt: z.number().describe("Unix timestamp when the job expires."),
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

export const CreateCronJobInputSchema = z.object({
  enabled: z.boolean().describe("Whether the job is enabled."),
  url: z.string().describe("The URL to call when the cron job executes."),
  schedule: CronJobScheduleInputSchema.describe(
    "Schedule configuration for the cron job.",
  ),
});

export interface CronJob {
  jobId: number;
  enabled: boolean;
  url: string;
  schedule: {
    timezone: string;
    // expiresAt: number;
    hours: number[];
    mdays: number[];
    minutes: number[];
    months: number[];
    wdays: number[];
  };
}

export class CreateCronJob implements Tool<
  typeof CreateCronJobInputSchema,
  CronJob
> {
  static name: string = "createCronJob";
  description: string = "Create a new cron job using the cron-job.org API.";
  inputSchema = CreateCronJobInputSchema;
  private readonly url: string;

  constructor(metaParams?: Record<string, any>) {
    this.url = metaParams?.url || "";
  }

  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof CreateCronJobInputSchema>,
  ): Promise<CronJob> {
    const cronToken = context.config?.cron_token;
    if (!cronToken) {
      throw new Error(
        "Cron token not found in context. Please provide a cron_token.",
      );
    }

    const response = await fetch("https://api.cron-job.org/jobs", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronToken}`,
      },
      body: JSON.stringify({ job: { ...input, url: this.url } }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create cron job: ${response.statusText}`);
    }

    const data = (await response.json()) as { jobId: number };

    return {
      ...input,
      url: this.url,
      jobId: data.jobId,
    };
  }
}
