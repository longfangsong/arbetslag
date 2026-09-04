import { Result, ok, err } from "neverthrow";

export interface OntologyConfig {
	baseUrl: string;
}

export const MemorySource = ["ai", "human"] as const;
export const MemoryStatus = ["pending", "verified", "rejected"] as const;

export async function ontologyRequest(
	baseUrl: string,
	path: string,
	options?: RequestInit,
): Promise<Result<unknown, string>> {
	try {
		const url = `${baseUrl}${path}`;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		const response = await fetch(url, { ...options, headers });
		const text = await response.text();

		if (!response.ok) {
			return err(`HTTP ${response.status}: ${text}`);
		}

		if (response.status === 204) {
			return ok({ deleted: true });
		}

		return ok(JSON.parse(text));
	} catch (e) {
		return err(
			`Request failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}
