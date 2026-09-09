import { z } from "zod";
import { ok, Result } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

const API_BASE_URL = "https://api.cron-job.org";

const FIELDS = [
	{ key: "minutes", min: 0, max: 59 },
	{ key: "hours", min: 0, max: 23 },
	{ key: "mdays", min: 1, max: 31 },
	{ key: "months", min: 1, max: 12 },
	{ key: "wdays", min: 0, max: 6 },
] as const;

function parseCronField(field: string, min: number, max: number): number[] | null {
	const values = new Set<number>();
	for (const part of field.split(",")) {
		const [rangePart, stepPart] = part.split("/");
		const step = stepPart === undefined ? 1 : Number(stepPart);
		if (!Number.isInteger(step) || step < 1) return null;
		let lo: number;
		let hi: number;
		if (rangePart === "*") {
			lo = min;
			hi = max;
		} else if (rangePart.includes("-")) {
			const [a, b] = rangePart.split("-").map(Number);
			if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
			lo = a;
			hi = b;
		} else {
			lo = hi = Number(rangePart);
			if (!Number.isInteger(lo)) return null;
		}
		if (lo < min || hi > max || lo > hi) return null;
		for (let v = lo; v <= hi; v += step) values.add(v);
	}
	return [...values].sort((a, b) => a - b);
}

/**
 * Parse a standard 5-field cron expression into cron-job.org schedule sets.
 * Returns null if the expression is invalid.
 */
export function parseCronExpression(
	expression: string,
): Record<(typeof FIELDS)[number]["key"], number[]> | null {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return null;

	const schedule: Record<string, number[]> = {};
	for (let i = 0; i < 5; i++) {
		let part = parts[i];
		if (i === 4) part = part.replace(/\b7\b/g, "0"); // cron 7 = Sunday
		const parsed = parseCronField(part, FIELDS[i].min, FIELDS[i].max);
		if (parsed === null) return null;
		schedule[FIELDS[i].key] = parsed;
	}
	return schedule as Record<(typeof FIELDS)[number]["key"], number[]>;
}

/** Shared bits for the cron tools: API key + one authenticated request. */
export abstract class CronTool<
	I extends { [key: string]: unknown },
	O,
> implements Tool<I, O, string>
{
	name!: string;
	description!: string;
	inputSchema!: z.ZodType<I>;

	protected readonly apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	protected async request(path: string, init?: RequestInit): Promise<unknown> {
		const res = await fetch(`${API_BASE_URL}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		});
		const data = (await res.json()) as { jobId?: number; error?: string };
		if (!res.ok) {
			throw new Error(
				`cron-job.org API error (HTTP ${res.status}): ${data.error ?? "unknown error"}`,
			);
		}
		return data;
	}

	abstract call(
		context: ToolExecutingContext,
		caller: Agent,
		input: I,
	): Promise<Result<O, string>>;
}
