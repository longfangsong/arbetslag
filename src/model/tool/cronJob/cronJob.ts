import { z } from "zod";
import { nanoid } from "nanoid";
import { Context } from "../../context";
import { Session } from "../../session";
import { Tool } from "..";
import type { CronJob, JobSchedule } from "./type";

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
  static name: string = "createCronJob";
  description: string =
    "Create a new cron job using the cron-job.org API. This tool registers an event listener and returns an eventId. AFTER calling this tool, you should call `awaitEvent` with the returned eventId to wait for the cron job's callback.";
  inputSchema = CronJobScheduleInputSchema;
  private readonly url: string;

  constructor(metaParams?: Record<string, any>) {
    this.url = metaParams?.url || "";
  }

  async handler(
    context: Context,
    session: Session,
    input: z.infer<typeof CronJobScheduleInputSchema>,
  ): Promise<CronJob> {
    const cronToken = context.config?.cron_token;
    if (!cronToken) {
      throw new Error(
        "Cron token not found in context. Please provide a cron_token.",
      );
    }

    const eventId = `cron-${nanoid(10)}`;
    const sessionId = session.id;
    const agentId = session.currentAgentId;

    if (context.eventRegistry && agentId) {
      await context.eventRegistry.register(eventId, sessionId, agentId);
    }
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
            body: JSON.stringify({ eventId, sessionId }),
          },
        },
      }),
    };
    const response = await fetch("https://api.cron-job.org/jobs", payload);

    if (!response.ok) {
      throw new Error(`Failed to create cron job: ${response.statusText}`);
    }

    const data = (await response.json()) as { jobId: number };

    return {
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
    };
  }
}
