// ── cron-job.org API Types ──────────────────────────────────────────────────

/** Job execution status (read-only) */
export type JobStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Job type (read-only) */
export type JobType = 0 | 1;

/** HTTP basic authentication settings */
export interface JobAuth {
  enable: boolean;
  user: string;
  password: string;
}

/** Notification settings for a job */
export interface JobNotificationSettings {
  onFailure: boolean;
  onFailureCount: number;
  onSuccess: boolean;
  onDisable: boolean;
}

/** Extended request data sent to the job URL */
export interface JobExtendedData {
  headers: Record<string, string>;
  body: string;
}

/** Schedule configuration for a cron job */
export interface JobSchedule {
  timezone: string;
  expiresAt: number;
  hours: number[];
  mdays: number[];
  minutes: number[];
  months: number[];
  wdays: number[];
}

/** Basic job fields (input for create/update) */
export interface Job {
  jobId?: number;
  enabled: boolean;
  title: string;
  saveResponses: boolean;
  url: string;
  lastStatus?: JobStatus;
  lastDuration?: number;
  lastExecution?: number;
  nextExecution?: number | null;
  type?: JobType;
  requestTimeout: number;
  redirectSuccess: boolean;
  folderId: number;
  schedule: JobSchedule;
}

/** Full job with all fields (read from API) */
export interface DetailedJob extends Job {
  auth?: JobAuth;
  notification?: JobNotificationSettings;
  extendedData?: JobExtendedData;
}

// ── Tool Types ───────────────────────────────────────────────────────────────

/** CronJob output returned to the agent */
export interface CronJob {
  jobId: number;
  eventId: string;
  enabled: boolean;
  url: string;
  schedule: JobSchedule;
}
